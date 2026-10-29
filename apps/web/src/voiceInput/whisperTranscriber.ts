import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

import type { WhisperWorkerRequest, WhisperWorkerResponse } from "./whisper.worker";

// Multilingual and about 100 MB on first use. The browser caches it, so later
// sessions load it from disk. Any Whisper ONNX export on Hugging Face works here.
const WHISPER_MODEL_ID = "onnx-community/whisper-base";
const WHISPER_SAMPLE_RATE = 16_000;

type PendingTranscript = {
  readonly resolve: (text: string) => void;
  readonly reject: (error: Error) => void;
};

let worker: Worker | null = null;
let ready: PromiseWithResolvers<void> | null = null;
let nextRequestId = 0;
const pendingTranscripts = new Map<number, PendingTranscript>();
let downloadProgress: number | null = null;
const downloadListeners = new Set<() => void>();

export function subscribeToWhisperModelDownload(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

/** Model download progress from 0 to 1, or `null` when nothing is downloading. */
export function getWhisperModelDownloadProgress(): number | null {
  return downloadProgress;
}

function notifyDownload(fraction: number | null) {
  // Downloads report thousands of byte updates; the composer only shows whole percents.
  const rounded = fraction === null ? null : Math.floor(fraction * 100) / 100;
  if (rounded === downloadProgress) return;
  downloadProgress = rounded;
  for (const listener of downloadListeners) listener();
}

function handleWorkerMessage(event: MessageEvent<WhisperWorkerResponse>) {
  const message = event.data;
  switch (message.type) {
    case "progress":
      if (message.total > 0) notifyDownload(message.loaded / message.total);
      return;
    case "ready":
      notifyDownload(null);
      ready?.resolve();
      return;
    case "transcript":
      pendingTranscripts.get(message.id)?.resolve(message.text);
      pendingTranscripts.delete(message.id);
      return;
    case "error": {
      const error = new Error(message.message);
      if (message.id === null) {
        notifyDownload(null);
        ready?.reject(error);
        ready = null;
        return;
      }
      pendingTranscripts.get(message.id)?.reject(error);
      pendingTranscripts.delete(message.id);
    }
  }
}

function postToWorker(request: WhisperWorkerRequest, transfer: Transferable[] = []) {
  if (!worker) {
    worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleWorkerMessage);
  }
  worker.postMessage(request, transfer);
}

async function decodeRecording(uri: string): Promise<Float32Array> {
  const bytes = await fetch(uri).then((response) => response.arrayBuffer());
  // Decoding through a 16 kHz context resamples to the rate Whisper expects.
  const audio = await new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE).decodeAudioData(bytes);
  return audio.getChannelData(0).slice();
}

export const whisperTranscriber: VoiceTranscriber = {
  prepare: async ({ signal }) => {
    if (!ready) {
      ready = Promise.withResolvers<void>();
      postToWorker({ type: "prepare", model: WHISPER_MODEL_ID });
    }
    try {
      await ready.promise;
    } catch (cause) {
      throw new VoiceTranscriptionError("preparation-failed", "Could not load the speech model.", {
        cause,
      });
    }
    throwIfVoiceTranscriptionAborted(signal);
    return {
      // Whisper detects the spoken language; the locale only steers spacing at the insertion point.
      locale: navigator.language,
      transcribe: async (uri, options) => {
        try {
          const audio = await decodeRecording(uri);
          throwIfVoiceTranscriptionAborted(options.signal);
          const id = ++nextRequestId;
          const text = await new Promise<string>((resolve, reject) => {
            pendingTranscripts.set(id, { resolve, reject });
            postToWorker({ type: "transcribe", id, audio }, [audio.buffer]);
          });
          throwIfVoiceTranscriptionAborted(options.signal);
          return text;
        } catch (cause) {
          if (cause instanceof VoiceTranscriptionError) throw cause;
          throw new VoiceTranscriptionError(
            "transcription-failed",
            "Could not transcribe this recording.",
            { cause },
          );
        }
      },
    };
  },
};

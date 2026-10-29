import {
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";

export type WhisperWorkerRequest =
  | { readonly type: "prepare"; readonly model: string }
  | { readonly type: "transcribe"; readonly id: number; readonly audio: Float32Array };

export type WhisperWorkerResponse =
  | { readonly type: "progress"; readonly loaded: number; readonly total: number }
  | { readonly type: "ready" }
  | { readonly type: "transcript"; readonly id: number; readonly text: string }
  | { readonly type: "error"; readonly id: number | null; readonly message: string };

let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function post(message: WhisperWorkerResponse) {
  self.postMessage(message, { transfer: [] });
}

function reportProgress(info: ProgressInfo) {
  if (info.status !== "progress_total") return;
  post({ type: "progress", loaded: info.loaded, total: info.total });
}

async function loadRecognizer(model: string) {
  const webgpu = "gpu" in navigator && (await navigator.gpu?.requestAdapter()) != null;
  return pipeline("automatic-speech-recognition", model, {
    device: webgpu ? "webgpu" : "wasm",
    // A full-precision encoder keeps WebGPU accurate; the decoder quantizes well.
    dtype: webgpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: reportProgress,
  });
}

self.addEventListener("message", (event: MessageEvent<WhisperWorkerRequest>) => {
  const request = event.data;
  if (request.type === "prepare") {
    recognizer ??= loadRecognizer(request.model);
    recognizer.then(
      () => post({ type: "ready" }),
      (error: unknown) => {
        recognizer = null;
        post({ type: "error", id: null, message: String(error) });
      },
    );
    return;
  }
  if (!recognizer) {
    post({ type: "error", id: request.id, message: "The speech model is not loaded." });
    return;
  }
  void recognizer
    .then((recognize) => recognize(request.audio, { chunk_length_s: 30, stride_length_s: 5 }))
    .then(
      (output) => {
        const text = (Array.isArray(output) ? output : [output]).map((part) => part.text).join("");
        post({ type: "transcript", id: request.id, text: text.trim() });
      },
      (error: unknown) => post({ type: "error", id: request.id, message: String(error) }),
    );
});

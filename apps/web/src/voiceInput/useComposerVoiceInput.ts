import { VoiceInputController, type VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { useEffect, useState, useSyncExternalStore } from "react";

import { isVoiceInputFeatureEnabled } from "~/env";
import { useStableCallback } from "~/hooks/useStableCallback";
import { toastManager } from "~/components/ui/toast";
import {
  BrowserVoiceRecorder,
  requestBrowserMicrophonePermission,
  supportsBrowserVoiceRecording,
} from "./browserVoiceRecorder";
import {
  getWhisperModelDownloadProgress,
  subscribeToWhisperModelDownload,
  whisperTranscriber,
} from "./whisperTranscriber";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

export const isComposerVoiceInputAvailable =
  isVoiceInputFeatureEnabled && supportsBrowserVoiceRecording();

export type ComposerVoiceInput = {
  readonly state: VoiceInputState;
  /** Model download progress from 0 to 1 on first use, otherwise `null`. */
  readonly downloadProgress: number | null;
  readonly toggle: () => void;
  readonly stop: () => void;
};

/**
 * Drives the shared voice controller against the web composer. `ownerKey`
 * scopes a recording to one draft; switching drafts cancels it.
 */
export function useComposerVoiceInput(input: {
  readonly ownerKey: string;
  readonly readDraft: () => { readonly text: string; readonly cursor: number };
  readonly commitDraft: (text: string, cursor: number) => void;
}): ComposerVoiceInput {
  const [state, setState] = useState(IDLE_STATE);
  const downloadProgress = useSyncExternalStore(
    subscribeToWhisperModelDownload,
    getWhisperModelDownloadProgress,
  );
  const readDraft = useStableCallback(() => {
    const draft = input.readDraft();
    return {
      ownerKey: input.ownerKey,
      text: draft.text,
      selection: { start: draft.cursor, end: draft.cursor },
      revision: 0,
    };
  });
  const commitDraft = useStableCallback(
    (text: string, selection: { readonly start: number; readonly end: number }) =>
      input.commitDraft(text, selection.start),
  );
  const [controller] = useState(() => {
    const recorder = new BrowserVoiceRecorder((status) => {
      void created.handleRecorderStatus(status);
    });
    const created: VoiceInputController = new VoiceInputController({
      recorder,
      getTranscriber: () => whisperTranscriber,
      requestPermission: requestBrowserMicrophonePermission,
      configureRecording: async () => {},
      releaseRecording: async () => recorder.release(),
      deleteRecording: (uri) => URL.revokeObjectURL(uri),
      readDraft,
      commitDraft,
      onStateChange: (next) => {
        // start() accepts the error phase, so the button can stay idle and retry.
        if (next.phase === "error") {
          if (next.error) toastManager.add({ type: "error", title: next.error });
          setState(IDLE_STATE);
          return;
        }
        setState(next);
      },
    });
    return created;
  });

  const { ownerKey } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the microphone held for this draft
  useEffect(
    () => () => controller.dispose(),
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A recording belongs to one draft, so switching drafts stops it.
    [controller, ownerKey],
  );

  return {
    state,
    downloadProgress,
    toggle: () => {
      if (state.phase === "recording") void controller.stop();
      else if (state.phase === "preparing") controller.cancel();
      else void controller.start();
    },
    stop: () => void controller.stop(),
  };
}

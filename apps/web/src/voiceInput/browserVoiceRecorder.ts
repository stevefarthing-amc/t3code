import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

export function supportsBrowserVoiceRecording(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== "undefined"
  );
}

/** Asks for the microphone without holding it open while the speech model loads. */
export async function requestBrowserMicrophonePermission(): Promise<{
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return { granted: true, canAskAgain: true };
  } catch {
    const status = await navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .catch(() => null);
    return { granted: false, canAskAgain: status?.state !== "denied" };
  }
}

/** Records into a blob URL; the controller revokes it through `deleteRecording`. */
export class BrowserVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped: Promise<string | null> | null = null;

  constructor(onStatus: (status: VoiceRecorderStatus) => void) {
    this.onStatus = onStatus;
  }

  async prepareToRecordAsync(): Promise<void> {
    this.uri = null;
    this.chunks = [];
    this.stopped = null;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(this.stream);
    recorder.addEventListener("dataavailable", (event) => this.chunks.push(event.data));
    recorder.addEventListener("error", () =>
      this.reportFailure("The microphone stopped recording."),
    );
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", () => this.reportFailure("The microphone was disconnected."));
    }
    this.recorder = recorder;
  }

  record(options: { readonly forDuration: number }): void {
    this.recorder?.start();
    this.limitTimer = setTimeout(() => {
      void this.stop().then(() =>
        this.onStatus({ isFinished: true, hasError: false, error: null, url: this.uri }),
      );
    }, options.forDuration * 1000);
  }

  stop(): Promise<void> {
    this.stopped ??= this.finish();
    return this.stopped.then(() => undefined);
  }

  /** Stops the microphone without waiting for a recording; safe to call repeatedly. */
  release(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private finish(): Promise<string | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.release();
      return Promise.resolve(this.uri);
    }
    return new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          this.release();
          this.uri = URL.createObjectURL(new Blob(this.chunks, { type: recorder.mimeType }));
          this.chunks = [];
          resolve(this.uri);
        },
        { once: true },
      );
      recorder.stop();
    });
  }

  private reportFailure(error: string): void {
    if (this.recorder?.state !== "recording") return;
    this.onStatus({ isFinished: false, hasError: true, error, url: null });
  }
}

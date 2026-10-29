import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ComposerVoiceInput } from "~/voiceInput/useComposerVoiceInput";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function voiceInputLabel(voiceInput: ComposerVoiceInput): string {
  switch (voiceInput.state.phase) {
    case "preparing":
      return voiceInput.downloadProgress === null
        ? "Starting voice input"
        : "Downloading speech model";
    case "recording":
      return "Stop and transcribe";
    case "transcribing":
      return "Transcribing";
    default:
      return "Voice input";
  }
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Counts whole seconds since mount; mounted only while recording. */
function RecordingElapsed() {
  const [seconds, setSeconds] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks a timer while the recording is on screen
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{formatElapsed(seconds)}</span>;
}

function VoiceInputStatus({ voiceInput }: { voiceInput: ComposerVoiceInput }) {
  const { phase } = voiceInput.state;
  if (phase === "idle" || phase === "error") return null;
  return (
    <span
      role="status"
      className="ms-1 truncate text-muted-foreground text-xs"
      data-voice-input-status={phase}
    >
      {phase === "preparing" ? (
        voiceInput.downloadProgress === null ? (
          "Starting…"
        ) : (
          <>
            Downloading speech model, one time only ·{" "}
            <span className="tabular-nums">{Math.round(voiceInput.downloadProgress * 100)}%</span>
          </>
        )
      ) : phase === "recording" ? (
        <>
          Listening <RecordingElapsed /> · Enter to finish
        </>
      ) : (
        "Transcribing…"
      )}
    </span>
  );
}

export function ComposerVoiceInputButton({ voiceInput }: { voiceInput: ComposerVoiceInput }) {
  const { phase } = voiceInput.state;
  const label = voiceInputLabel(voiceInput);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={phase === "recording" ? "destructive-outline" : "ghost"}
              size="icon-sm"
              // Keep focus in the editor so Enter stops the recording.
              onPointerDown={(event) => event.preventDefault()}
              onClick={voiceInput.toggle}
              disabled={phase === "transcribing"}
              aria-label={label}
              aria-pressed={phase === "recording"}
            />
          }
        >
          {phase === "preparing" || phase === "transcribing" ? (
            <Spinner aria-hidden />
          ) : phase === "recording" ? (
            <SquareIcon />
          ) : (
            <MicIcon />
          )}
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <VoiceInputStatus voiceInput={voiceInput} />
    </>
  );
}

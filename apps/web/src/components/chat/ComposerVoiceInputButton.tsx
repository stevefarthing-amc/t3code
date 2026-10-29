import { MicIcon, SquareIcon } from "lucide-react";

import type { ComposerVoiceInput } from "~/voiceInput/useComposerVoiceInput";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function voiceInputLabel(voiceInput: ComposerVoiceInput): string {
  switch (voiceInput.state.phase) {
    case "preparing":
      return voiceInput.downloadProgress === null
        ? "Starting voice input"
        : `Downloading speech model (${Math.round(voiceInput.downloadProgress * 100)}%)`;
    case "recording":
      return "Stop and transcribe";
    case "transcribing":
      return "Transcribing";
    default:
      return "Voice input";
  }
}

export function ComposerVoiceInputButton({ voiceInput }: { voiceInput: ComposerVoiceInput }) {
  const { phase } = voiceInput.state;
  const label = voiceInputLabel(voiceInput);
  return (
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
  );
}

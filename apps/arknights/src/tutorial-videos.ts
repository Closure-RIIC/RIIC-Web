type TutorialVideoFile =
  | "maa-box.mp4"
  | "manual-schedule-audio.mp4"
  | "shifts-orundum-audio.mp4"
  | "export-maa.mp4";

/** Nginx serves this directory independently of the application release. */
export function tutorialVideoUrl(file: TutorialVideoFile): string {
  return `/media/tutorials/${file}`;
}

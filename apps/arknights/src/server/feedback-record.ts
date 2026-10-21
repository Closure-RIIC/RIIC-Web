import type { FeedbackRequest } from "../types";

export function feedbackDirectoryGroup(body: FeedbackRequest): string {
  return body.kind === "performance_issue" ? "performance" : body.room.group;
}

export function toStoredFeedbackIssue(body: FeedbackRequest) {
  if (body.kind === "performance_issue") {
    return {
      type: "performance_issue" as const,
      diagnosticId: body.diagnosticId,
      note: body.note,
      consent: true as const,
    };
  }
  return {
    type: "room_issue" as const,
    diagnosticId: body.diagnosticId,
    room: {
      id: body.room.id,
      title: body.room.title,
      group: body.room.group,
      operators: [...body.room.operators],
    },
    note: body.note,
    consent: true as const,
  };
}

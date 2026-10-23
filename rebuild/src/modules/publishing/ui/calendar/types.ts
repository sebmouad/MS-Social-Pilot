import type { ChannelMark } from "@/components";
import type { PostPreviewPost } from "@/components/PostPreview";

export type BoardChannel = { id: string; name: string; platformName: string; mark: ChannelMark };

export type BoardPost = {
  id: string;
  text: string;
  status: string;
  /** Scheduled or published instant (ISO). */
  whenIso: string;
  /** Server-formatted workspace-local clock label to keep hydration stable. */
  clockLabel?: string;
  /** Server-resolved workspace-local wall time for stable week columns and moves. */
  wallTime?: { date: string; time: string };
  /** Server-computed enabled move choices for this post. */
  moveOptions?: import("@/lib/reschedule").MoveCandidate[];
  channels: BoardChannel[];
  /** Scoped source row used by the shared full post preview dialog. */
  preview?: PostPreviewPost;
  authorName?: string;
  /** Set when an installed automation created the post. */
  origin?: import("../origins/post-origin").PostOriginView;
  /** The viewer may move this post: still waiting to publish and editable by them. */
  movable: boolean;
};

/** Advisory autopilot guardrails for conflict warnings: quiet window, daily cap and scheduled sends per day. */
export type CalendarGuardrails = {
  quietStartHour: number;
  quietEndHour: number;
  maxSendsPerDay: number;
  sendsByDay: Record<string, number>;
};

export type BoardDay = {
  key: string;
  /** Short heading such as "Tue 20". */
  label: string;
  /** Full text for assistive technology, such as "Tuesday, October 20". */
  longLabel: string;
  inMonth: boolean;
  isToday: boolean;
  /** The whole day is before today in the workspace time zone. */
  isPast: boolean;
  /** Server-computed ended state for each local hour, keyed by zero-padded HH:00. */
  slotEndedByHour?: Record<string, boolean>;
  /** Key dates saved for this day (launches, sales, yearly milestones). */
  milestones?: Array<{ id: string; title: string }>;
  /** Free queue times (HH:MM) in the workspace time zone, shown as pills that open Create at that time. */
  freeSlots?: string[];
  posts: BoardPost[];
};

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
  posts: BoardPost[];
};

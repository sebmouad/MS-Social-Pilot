import type { ChannelMark } from "@/components";

export type BoardChannel = { id: string; name: string; platformName: string; mark: ChannelMark };

export type BoardPost = {
  id: string;
  text: string;
  status: string;
  /** Scheduled or published instant (ISO). */
  whenIso: string;
  channels: BoardChannel[];
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
  posts: BoardPost[];
};

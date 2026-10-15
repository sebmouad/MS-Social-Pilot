import type { ReactNode } from "react";
import { PageFrame } from "@/server/PageFrame";
import styles from "./publishing.module.css";

export default function PublishingLayout({ children }: { children: ReactNode }) {
  return <PageFrame module="publishing" scopedAccess><div className={styles.page}>
    {children}
  </div></PageFrame>;
}

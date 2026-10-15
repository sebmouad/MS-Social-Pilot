import type { NextRequest, NextResponse } from 'next/server';
import type { PlatformId } from '@/platforms';
import type { PlatformAdapter } from '@/platforms/types';
import { configuredFacebookAdapter, configuredFacebookOAuth } from './facebook';
import { finishFacebookConnection, startFacebookConnection } from './facebook-connect';

/** The viewer fields a connection flow needs; the routes check role and access first. */
export interface ConnectionViewer {
  user: { id: string };
  workspaceId: string;
}

/** Server wiring of one installed platform module. */
export interface PlatformHost {
  /** Build the engine from Root settings. */
  adapter(): Promise<PlatformAdapter>;
  connection: {
    /** True when Root has filled in what a customer needs to connect. */
    isReady(): Promise<boolean>;
    start(request: Request, viewer: ConnectionViewer): Promise<NextResponse>;
    callback(request: NextRequest, viewer: ConnectionViewer): Promise<NextResponse>;
  };
}

/** One entry per module in `src/platforms/index.ts`; the type keeps the two lists in step. */
export const PLATFORM_HOSTS: Readonly<Record<PlatformId, PlatformHost>> = {
  facebook: {
    adapter: configuredFacebookAdapter,
    connection: {
      isReady: () => configuredFacebookOAuth().then(() => true, () => false),
      start: startFacebookConnection,
      callback: finishFacebookConnection,
    },
  },
};

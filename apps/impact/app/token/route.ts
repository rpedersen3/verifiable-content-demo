export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { onRequestPost, onRequestOptions } from "../../server/token";
import { makeEnv } from "../_lib/env";
import { jsonErrorBoundary } from "../_lib/route";

export const POST = jsonErrorBoundary((request) => onRequestPost({ request, env: makeEnv() }));
export const OPTIONS = (request: Request) => onRequestOptions({ request, env: makeEnv() });

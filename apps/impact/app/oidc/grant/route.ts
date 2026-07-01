export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { onRequestPost } from "../../../server/oidc/grant";
import { makeEnv } from "../../_lib/env";
import { jsonErrorBoundary } from "../../_lib/route";

export const POST = jsonErrorBoundary((request) => onRequestPost({ request, env: makeEnv() }));

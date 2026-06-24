export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { onRequestGet } from "../../../../server/oidc/youversion/callback";
import { makeEnv } from "../../../_lib/env";
import { jsonErrorBoundary } from "../../../_lib/route";

export const GET = jsonErrorBoundary((request) => onRequestGet({ request, env: makeEnv() }));

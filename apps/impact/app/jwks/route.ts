export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { onRequestGet, onRequestOptions } from '../../server/jwks';
import { makeEnv } from '../_lib/env';
import { jsonErrorBoundary } from '../_lib/route';

export const GET = jsonErrorBoundary((request) => onRequestGet({ request, env: makeEnv() }));
export const OPTIONS = (request: Request) => onRequestOptions({ request, env: makeEnv() });

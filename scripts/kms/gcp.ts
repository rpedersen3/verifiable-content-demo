// Thin GCP helpers for the orchestrator. Provisioning (keyring/keys + per-key IAM, gcloud-free REST) now
// lives upstream in @agenticprimitives/key-custody/provision-gcp (createGcpRestStepExecutor +
// planGcpProvision/executeGcpProvision, backlog B1–B3). This module only loads the admin SA and does the
// read-only address derivation that --verify needs.
import { readFileSync } from 'node:fs';
import { addressFromSpkiPem, createGcpKmsTransport, parseServiceAccountJson } from '@agenticprimitives/key-custody/kms-core';

export interface LoadedSA {
  /** The raw single-line JSON (passed to createGcpRestStepExecutor / written as a runtime secret). */
  raw: string;
  client_email: string;
  project_id: string;
}

export function loadServiceAccount(file: string): LoadedSA {
  const raw = readFileSync(file, 'utf8').trim();
  const sa = parseServiceAccountJson(raw) as { client_email: string; project_id?: string };
  if (!sa.project_id) throw new Error(`service account ${file} missing project_id`);
  return { raw, client_email: sa.client_email, project_id: sa.project_id };
}

/** Derive a KMS key's EVM signing address from its SPKI public key (read-only; null if the key is absent). */
export async function deriveKeyAddress(saRaw: string, keyVersionName: string): Promise<`0x${string}` | null> {
  try {
    const transport = createGcpKmsTransport(parseServiceAccountJson(saRaw));
    return addressFromSpkiPem(await transport.getPublicKeyPem(keyVersionName));
  } catch {
    return null;
  }
}

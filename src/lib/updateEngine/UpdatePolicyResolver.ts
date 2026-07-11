import { fetchAppReleaseClientPolicy, type AppReleaseClientPolicy } from "../appReleaseClient";

export type ResolvedUpdatePolicy = AppReleaseClientPolicy;

export async function fetchReleasePolicy(): Promise<ResolvedUpdatePolicy | null> {
  return fetchAppReleaseClientPolicy();
}

import { get } from 'svelte/store';
import { currentIdentityStore } from '../stores.js';
import { orbitDBStore } from '../p2p.js';

const PROFILE_KEY = 'profile';

async function openRegistryDb(identityId) {
  const orbitdb = get(orbitDBStore);
  if (!orbitdb) throw new Error('OrbitDB not initialized');
  return orbitdb.open(identityId, { type: 'keyvalue', create: true, sync: true });
}

export async function getIdentityProfile(identityId = null) {
  const resolvedId = identityId || get(currentIdentityStore)?.id || null;
  if (!resolvedId) return null;

  const registryDb = await openRegistryDb(resolvedId);
  const profile = await registryDb.get(PROFILE_KEY);
  await registryDb.close();
  return profile || null;
}

export async function setIdentityProfile(profile, identityId = null) {
  const resolvedId = identityId || get(currentIdentityStore)?.id || null;
  if (!resolvedId) throw new Error('Identity not available');

  const registryDb = await openRegistryDb(resolvedId);
  await registryDb.put(PROFILE_KEY, profile);
  await registryDb.close();
  return profile;
}

export async function setWalletAddressForCurrentIdentity(walletAddress) {
  const existing = (await getIdentityProfile()) || {};
  const next = { ...existing, walletAddress };
  await setIdentityProfile(next);
  return next;
}

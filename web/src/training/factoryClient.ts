import { loginFactoryAccount, loadTrainingCharacters, loadMinerTraining, type ApiOptions } from "../app/api.ts";
import type { StageFittingSelection } from "./types.ts";

export async function readFactoryAccount(account: string, options: ApiOptions = {}) {
  const auth = await loginFactoryAccount(account, options);
  const requestOptions = { ...options, token: auth.token };
  const roster = await loadTrainingCharacters(requestOptions);
  if (roster.account !== auth.account) throw new Error("Account identity changed during roster read.");
  return { ...roster, requestOptions };
}

export async function readFactoryPilot(characterID: number, selections: Readonly<Record<string, StageFittingSelection>>, options: ApiOptions) {
  return loadMinerTraining(characterID, selections, options);
}

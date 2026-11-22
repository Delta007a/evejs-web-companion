<script lang="ts">
  import { onDestroy } from "svelte";
  import { createAccountPass, loginFactoryAccount, logout } from "../../../web/src/plugin-api/index.ts";
  import "./page.css";
  import ModulePage from "./ModulePage.svelte";
  import { resolveUocPage } from "./route.ts";

  const page = resolveUocPage(location.pathname, location.search);
  const accountPass = createAccountPass({
    async signIn(name) {
      const account = await loginFactoryAccount(name, { priority: "user" });
      if (account.account.toLowerCase() !== name.toLowerCase()) throw new Error("WC returned a different account.");
      return account.token;
    },
    signOut: token => logout({ token }),
  });
  onDestroy(() => { void accountPass.release(); });
</script>

<div class="standalone-uoc">
  {#if page}
    <ModulePage {page} {accountPass} />
  {:else}
    <p>Operations Center page unavailable. <a href="/uoc/">Open UOC</a></p>
  {/if}
</div>

<style>
  .standalone-uoc { min-height: 100vh; background: #05080d; }
</style>

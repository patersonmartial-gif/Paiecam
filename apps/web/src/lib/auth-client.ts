import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // On garde ?next= pour revenir, par exemple, à une invitation après la 2FA.
        window.location.href = `/connexion/2fa${window.location.search}`;
      },
    }),
  ],
});

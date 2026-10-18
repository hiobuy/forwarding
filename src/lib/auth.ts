import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient(),
    inferAdditionalFields({
      user: {
        memberCode: { type: "string", required: false },
        phone: { type: "string", required: false },
        country: { type: "string", required: false },
        status: { type: "string", required: false },
      },
    }),
  ],
});

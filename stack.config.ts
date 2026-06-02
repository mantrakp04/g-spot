import type { HexclaveConfig } from "@hexclave/react";

export const config: HexclaveConfig = {
  "emails": {
    "selectedThemeId": "a0172b5d-cff0-463b-83bb-85124697373a"
  },
  "auth": {
    "otp": {
      "allowSignIn": false
    },
    "passkey": {
      "allowSignIn": false
    },
    "password": {
      "allowSignIn": false
    }
  },
  "payments": {
    "products": {
      "test1": {
        "prices": {
          "manual": {
            "USD": "0"
          }
        },
        "freeTrial": [
          7,
          "day"
        ],
        "isAddOnTo": false,
        "stackable": true,
        "serverOnly": true,
        "displayName": "test1",
        "customerType": "user",
        "includedItems": {}
      }
    }
  },
  "dataVault": {
    "stores": {
      "gcp-tokens": {
        "displayName": "Store gcp-tokens"
      }
    }
  },
  "apps": {
    "installed": {
      "neon": {
        "enabled": false
      },
      "rbac": {
        "enabled": true
      },
      "teams": {
        "enabled": true
      },
      "convex": {
        "enabled": false
      },
      "emails": {
        "enabled": true
      },
      "vercel": {
        "enabled": false
      },
      "tv-mode": {
        "enabled": false
      },
      "api-keys": {
        "enabled": true
      },
      "catalyst": {
        "enabled": false
      },
      "payments": {
        "enabled": true
      },
      "webhooks": {
        "enabled": false
      },
      "analytics": {
        "enabled": true
      },
      "email-api": {
        "enabled": false
      },
      "data-vault": {
        "enabled": true
      },
      "onboarding": {
        "enabled": false
      },
      "authentication": {
        "enabled": true
      },
      "launch-checklist": {
        "enabled": false
      }
    }
  }
};

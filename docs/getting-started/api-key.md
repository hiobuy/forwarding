# API key and warehouse authorization

> Status: Implemented

The API key stays in the Worker. Settings responses return only the last 4 characters. React never stores or concatenates the full key.

## Save order

1. Open `/admin/settings`, Integration tab.
2. Paste a Production key (`hio_live_*`). A key saved on the page wins over `HIOBUY_API_TOKEN`.
3. Before the key is kept, the server requests both the warehouse address and the channel destinations. One success is not enough.
4. On success it writes `warehouse_locations` and syncs countries into `freight_areas`. Country switches that were already set are kept.
5. The customer warehouse address comes only from that sync. Until it succeeds, the address is empty. Do not ship to a placeholder address.

The environment variable is the fallback for deploy secrets. Locally, `HIOBUY_API_TOKEN` in `.dev.vars` is used when the page has not saved a key.

## How authorization failures are shown

`server/freight.ts` maps these upstream codes:

| Upstream code | This app |
| --- | --- |
| `INVALID_API_KEY` | The key was rejected. Check the portal or create a new Production key |
| `FULFILLMENT_MODE_NOT_SUPPORTED` | Fulfillment mode is not HioBuy warehouse |
| `WAREHOUSE_AUTH_INVALID` | The warehouse rejected developer authentication. Bind the code HioBuy provides |
| `UPSTREAM_TIMEOUT` | Timeout. A saved key is not marked invalid |

Other 401 and 403 responses do not each get a dedicated screen. Sync tasks pause, and Settings shows the upstream message. See [INSUFFICIENT_SCOPE](../troubleshooting/insufficient-scope.md) and [Warehouse authorization](../troubleshooting/warehouse-authorization.md).

## Warehouse code

The warehouse developer code is bound in the portal. It is not stored in this database and it is not placed in the request body. To change warehouses, rebind in the portal, then test the connection and sync the address again.

## Code

- `connectHioBuy`, `verifyHioBuyAccess`, `saveApiKey` in `server/freight.ts`
- `server/services/hiobuy/locations.ts`
- `server/services/hiobuy/channels.ts`
- Settings page: `src/features/admin/AdminSettings.tsx`
- Tables: `freight_policy.api_key`, `warehouse_locations`, `freight_areas`

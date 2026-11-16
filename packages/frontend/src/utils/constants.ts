/// <reference types="vite/client" />

export const ENV_ADDRESSES = {
  otc: import.meta.env.VITE_OTC_ADDRESS as string | undefined,
  pool: import.meta.env.VITE_POOL_ADDRESS as string | undefined,
  htlc: import.meta.env.VITE_HTLC_ADDRESS as string | undefined,
};

export const NATIVE_TOKEN =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

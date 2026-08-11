import { QueryClient } from "@tanstack/react-query";

/** Shared React Query client — cleared on enterprise logout. */
export const queryClient = new QueryClient();

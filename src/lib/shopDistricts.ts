import { supabase } from "./supabase";

export type DistrictRow = { id: string; code: string; name: string; region: string | null };

export async function fetchDistricts(): Promise<DistrictRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("districts").select("id, code, name, region").order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data as DistrictRow[];
}

import { supabase } from "./supabase";

export type DistrictRow = { id: string; code: string; name: string; region: string | null };

export type FetchDistrictsResult = { districts: DistrictRow[]; error: string | null };

export async function fetchDistricts(): Promise<FetchDistrictsResult> {
  if (!supabase) return { districts: [], error: null };
  const { data, error } = await supabase.from("districts").select("id, code, name, region").order("sort_order", { ascending: true });
  if (error) return { districts: [], error: error.message };
  if (!data?.length) return { districts: [], error: null };
  return { districts: data as DistrictRow[], error: null };
}

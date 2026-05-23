export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          owner_name: string | null
          phone: string | null
          shop_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          owner_name?: string | null
          phone?: string | null
          shop_name?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          owner_name?: string | null
          phone?: string | null
          shop_name?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: []
      }
      shop_cash_entries: {
        Row: {
          amount: number
          category: string | null
          client_created_at: number
          deleted_at: string | null
          id: string
          kind: string
          method: string
          note: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          client_created_at: number
          deleted_at?: string | null
          id: string
          kind: string
          method?: string
          note?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          client_created_at?: number
          deleted_at?: string | null
          id?: string
          kind?: string
          method?: string
          note?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shop_customers: {
        Row: {
          balance: number
          client_created_at: number
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          balance?: number
          client_created_at: number
          deleted_at?: string | null
          id: string
          name: string
          owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          balance?: number
          client_created_at?: number
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shop_day_sessions: {
        Row: {
          closed_at: number | null
          counted_cash: number | null
          deleted_at: string | null
          expected_cash: number | null
          id: string
          note: string | null
          opened_at: number
          opening_float: number
          owner_id: string
          updated_at: string
          variance: number | null
        }
        Insert: {
          closed_at?: number | null
          counted_cash?: number | null
          deleted_at?: string | null
          expected_cash?: number | null
          id: string
          note?: string | null
          opened_at: number
          opening_float: number
          owner_id: string
          updated_at?: string
          variance?: number | null
        }
        Update: {
          closed_at?: number | null
          counted_cash?: number | null
          deleted_at?: string | null
          expected_cash?: number | null
          id?: string
          note?: string | null
          opened_at?: number
          opening_float?: number
          owner_id?: string
          updated_at?: string
          variance?: number | null
        }
        Relationships: []
      }
      shop_products: {
        Row: {
          category: string | null
          client_created_at: number
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          price: number
          stock: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_created_at: number
          deleted_at?: string | null
          id: string
          name: string
          owner_id: string
          price?: number
          stock?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_created_at?: number
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          price?: number
          stock?: number
          updated_at?: string
        }
        Relationships: []
      }
      shop_sales: {
        Row: {
          client_created_at: number
          customer_id: string | null
          customer_name: string | null
          deleted_at: string | null
          id: string
          items: Json
          method: string
          owner_id: string
          total: number
          updated_at: string
        }
        Insert: {
          client_created_at: number
          customer_id?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          id: string
          items: Json
          method: string
          owner_id: string
          total: number
          updated_at?: string
        }
        Update: {
          client_created_at?: number
          customer_id?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          id?: string
          items?: Json
          method?: string
          owner_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      shop_supplier_entries: {
        Row: {
          amount: number
          client_created_at: number
          deleted_at: string | null
          id: string
          note: string | null
          owner_id: string
          supplier_id: string
          supplier_name: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          client_created_at: number
          deleted_at?: string | null
          id: string
          note?: string | null
          owner_id: string
          supplier_id: string
          supplier_name: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_created_at?: number
          deleted_at?: string | null
          id?: string
          note?: string | null
          owner_id?: string
          supplier_id?: string
          supplier_name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      shop_suppliers: {
        Row: {
          balance: number
          client_created_at: number
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          balance?: number
          client_created_at: number
          deleted_at?: string | null
          id: string
          name: string
          owner_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          balance?: number
          client_created_at?: number
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waka_billing_offers: {
        Row: {
          amount_ugx: number
          created_at: string
          id: string
          message: string | null
          org_id: string | null
          shop_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_ugx: number
          created_at?: string
          id?: string
          message?: string | null
          org_id?: string | null
          shop_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_ugx?: number
          created_at?: string
          id?: string
          message?: string | null
          org_id?: string | null
          shop_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_billing_offers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_business_activations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_device_limit: number | null
          approved_plan_code: string | null
          approved_valid_days: number | null
          business_name: string
          created_at: string
          id: string
          owner_email: string | null
          phone: string | null
          reference_code: string
          rejection_reason: string | null
          requested_by_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_device_limit?: number | null
          approved_plan_code?: string | null
          approved_valid_days?: number | null
          business_name: string
          created_at?: string
          id?: string
          owner_email?: string | null
          phone?: string | null
          reference_code: string
          rejection_reason?: string | null
          requested_by_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_device_limit?: number | null
          approved_plan_code?: string | null
          approved_valid_days?: number | null
          business_name?: string
          created_at?: string
          id?: string
          owner_email?: string | null
          phone?: string | null
          reference_code?: string
          rejection_reason?: string | null
          requested_by_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      waka_districts: {
        Row: {
          created_at: string
          id: string
          name: string
          region: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          region?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          region?: string | null
        }
        Relationships: []
      }
      waka_field_visits: {
        Row: {
          assigned_agent_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          note: string | null
          shop_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          shop_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          shop_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_field_visits_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_internal_admins: {
        Row: {
          assigned_districts: string[]
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_districts?: string[]
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_districts?: string[]
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waka_sales: {
        Row: {
          amount_ugx: number
          created_at: string
          id: string
          occurred_at: string
          shop_id: string
        }
        Insert: {
          amount_ugx?: number
          created_at?: string
          id?: string
          occurred_at?: string
          shop_id: string
        }
        Update: {
          amount_ugx?: number
          created_at?: string
          id?: string
          occurred_at?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_sales_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_shop_devices: {
        Row: {
          app_version: string | null
          created_at: string
          fingerprint: string
          id: string
          is_active: boolean
          label: string | null
          last_seen_at: string | null
          platform: string | null
          shop_id: string
          suspicious: boolean
          trusted: boolean
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          fingerprint: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_seen_at?: string | null
          platform?: string | null
          shop_id: string
          suspicious?: boolean
          trusted?: boolean
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          fingerprint?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_seen_at?: string | null
          platform?: string | null
          shop_id?: string
          suspicious?: boolean
          trusted?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_shop_devices_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_shops: {
        Row: {
          business_type: string | null
          city: string | null
          created_at: string
          district_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          last_sync_error: string | null
          last_sync_pull_at: string | null
          last_sync_push_at: string | null
          name: string
          org_id: string | null
          owner_email: string | null
          owner_name: string | null
          owner_user_id: string
          payment_status: string
          pending_sync_count: number
          phone: string | null
          plan_code: string
          reference_code: string | null
          subscription_end_at: string | null
          subscription_status: string
          trial_end_at: string | null
          updated_at: string
        }
        Insert: {
          business_type?: string | null
          city?: string | null
          created_at?: string
          district_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          last_sync_error?: string | null
          last_sync_pull_at?: string | null
          last_sync_push_at?: string | null
          name: string
          org_id?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_user_id: string
          payment_status?: string
          pending_sync_count?: number
          phone?: string | null
          plan_code?: string
          reference_code?: string | null
          subscription_end_at?: string | null
          subscription_status?: string
          trial_end_at?: string | null
          updated_at?: string
        }
        Update: {
          business_type?: string | null
          city?: string | null
          created_at?: string
          district_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          last_sync_error?: string | null
          last_sync_pull_at?: string | null
          last_sync_push_at?: string | null
          name?: string
          org_id?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_user_id?: string
          payment_status?: string
          pending_sync_count?: number
          phone?: string | null
          plan_code?: string
          reference_code?: string | null
          subscription_end_at?: string | null
          subscription_status?: string
          trial_end_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_shops_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "waka_districts"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_subscription_payments: {
        Row: {
          amount_ugx: number
          created_at: string
          id: string
          paid_at: string
          plan_code: string | null
          shop_id: string
          status: string
        }
        Insert: {
          amount_ugx: number
          created_at?: string
          id?: string
          paid_at?: string
          plan_code?: string | null
          shop_id: string
          status?: string
        }
        Update: {
          amount_ugx?: number
          created_at?: string
          id?: string
          paid_at?: string
          plan_code?: string | null
          shop_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_subscription_payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_subscription_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          org_id: string | null
          requested_plan: string
          shop_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string | null
          requested_plan: string
          shop_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string | null
          requested_plan?: string
          shop_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_subscription_requests_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      waka_support_tickets: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          id: string
          issue_type: string
          owner_user_id: string | null
          priority: string
          shop_id: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          issue_type?: string
          owner_user_id?: string | null
          priority?: string
          shop_id?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          issue_type?: string
          owner_user_id?: string | null
          priority?: string
          shop_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waka_support_tickets_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "waka_shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_shop_set_subscription_plan: {
        Args: { _days_valid: number; _plan_code: string; _shop_id: string }
        Returns: undefined
      }
      has_internal_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      internal_admin_create_by_email: {
        Args: {
          _districts: string[]
          _email: string
          _full_name: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      internal_admin_update_role_and_districts: {
        Args: {
          _districts: string[]
          _full_name: string
          _is_active: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      internal_ops_charts_7d: { Args: never; Returns: Json }
      internal_ops_dashboard_metrics: { Args: never; Returns: Json }
      is_internal_admin: { Args: never; Returns: boolean }
      ops_resolve_activation_request: {
        Args: {
          _approve: boolean
          _device_limit: number
          _id: string
          _plan_code: string
          _reason: string
          _valid_days: number
        }
        Returns: undefined
      }
      waka_internal_me: {
        Args: never
        Returns: {
          assigned_districts: string[]
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "waka_internal_admins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "support"
        | "owner"
        | "super_admin"
        | "operations_admin"
        | "support_admin"
        | "field_agent"
      profile_status: "pending" | "active" | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "support",
        "owner",
        "super_admin",
        "operations_admin",
        "support_admin",
        "field_agent",
      ],
      profile_status: ["pending", "active", "suspended"],
    },
  },
} as const

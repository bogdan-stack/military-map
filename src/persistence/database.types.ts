export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      graphics: {
        Row: {
          affiliation: string;
          basic_id: string;
          color: string;
          coordinates: Json;
          echelon: string;
          extra: Json;
          feint: boolean;
          headquarters: boolean;
          id: string;
          kind: string;
          layer_id: string;
          legacy_id: string | null;
          modifiers: Json;
          name: string;
          renderer: string;
          rotation: number | null;
          scale: number | null;
          sort_order: number;
          status: string;
          task_force: boolean;
          workspace_id: string;
        };
        Insert: {
          affiliation?: string;
          basic_id?: string;
          color?: string;
          coordinates?: Json;
          echelon?: string;
          extra?: Json;
          feint?: boolean;
          headquarters?: boolean;
          id: string;
          kind?: string;
          layer_id: string;
          legacy_id?: string | null;
          modifiers?: Json;
          name?: string;
          renderer?: string;
          rotation?: number | null;
          scale?: number | null;
          sort_order?: number;
          status?: string;
          task_force?: boolean;
          workspace_id: string;
        };
        Update: {
          affiliation?: string;
          basic_id?: string;
          color?: string;
          coordinates?: Json;
          echelon?: string;
          extra?: Json;
          feint?: boolean;
          headquarters?: boolean;
          id?: string;
          kind?: string;
          layer_id?: string;
          legacy_id?: string | null;
          modifiers?: Json;
          name?: string;
          renderer?: string;
          rotation?: number | null;
          scale?: number | null;
          sort_order?: number;
          status?: string;
          task_force?: boolean;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "graphics_layer_id_fkey";
            columns: ["layer_id"];
            isOneToOne: false;
            referencedRelation: "layers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "graphics_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      layers: {
        Row: {
          extra: Json;
          id: string;
          legacy_id: string | null;
          locked: boolean;
          name: string;
          sort_order: number;
          visible: boolean;
          workspace_id: string;
        };
        Insert: {
          extra?: Json;
          id: string;
          legacy_id?: string | null;
          locked?: boolean;
          name?: string;
          sort_order?: number;
          visible?: boolean;
          workspace_id: string;
        };
        Update: {
          extra?: Json;
          id?: string;
          legacy_id?: string | null;
          locked?: boolean;
          name?: string;
          sort_order?: number;
          visible?: boolean;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "layers_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      user_settings: {
        Row: {
          favorites: Json;
          last_workspace_id: string | null;
          options: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          favorites?: Json;
          last_workspace_id?: string | null;
          options?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          favorites?: Json;
          last_workspace_id?: string | null;
          options?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_settings_last_workspace_id_fkey";
            columns: ["last_workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          active_layer_id: string | null;
          created_at: string;
          id: string;
          import_key: string | null;
          name: string;
          owner_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          active_layer_id?: string | null;
          created_at?: string;
          id?: string;
          import_key?: string | null;
          name: string;
          owner_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          active_layer_id?: string | null;
          created_at?: string;
          id?: string;
          import_key?: string | null;
          name?: string;
          owner_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      save_workspace: {
        Args: {
          p_active_layer_id: string | null;
          p_expected_version: number;
          p_graphics: Json;
          p_layers: Json;
          p_name: string;
          p_owner_id?: string;
          p_workspace_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

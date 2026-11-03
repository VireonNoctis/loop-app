export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string
          email: string
          avatar_url: string | null
          banner_url: string | null
          bio: string | null
          location: string | null
          website: string | null
          loop_coins: number
          total_earnings: number
          available_earnings: number
          is_premium: boolean
          is_verified: boolean
          is_team_member: boolean
          is_sponsor: boolean
          is_admin: boolean
          onboarding_completed: boolean
          active_theme: string | null
          xp_points: number
          level: number
          premium_expires_at: string | null
          verification_level: 'none' | 'basic' | 'influencer' | 'root' | null
          can_stream: boolean
          stream_key: string | null
          theme_data: Json | null
          privacy_settings: Json | null
          notification_settings: Json | null
          discovery_preferences: Json
          followers_count: number
          following_count: number
          loops_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name: string
          email: string
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          location?: string | null
          website?: string | null
          loop_coins?: number
          total_earnings?: number
          available_earnings?: number
          is_premium?: boolean
          is_verified?: boolean
          is_admin?: boolean
          onboarding_completed?: boolean
          active_theme?: string | null
          xp_points?: number
          level?: number
          premium_expires_at?: string | null
          verification_level?: 'none' | 'basic' | 'influencer' | 'root' | null
          can_stream?: boolean
          stream_key?: string | null
          theme_data?: Json | null
          privacy_settings?: Json | null
          notification_settings?: Json | null
          discovery_preferences?: Json
          followers_count?: number
          following_count?: number
          loops_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string
          email?: string
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          location?: string | null
          website?: string | null
          loop_coins?: number
          total_earnings?: number
          available_earnings?: number
          is_premium?: boolean
          is_verified?: boolean
          is_admin?: boolean
          onboarding_completed?: boolean
          active_theme?: string | null
          xp_points?: number
          level?: number
          premium_expires_at?: string | null
          verification_level?: 'none' | 'basic' | 'influencer' | 'root' | null
          can_stream?: boolean
          stream_key?: string | null
          theme_data?: Json | null
          privacy_settings?: Json | null
          notification_settings?: Json | null
          discovery_preferences?: Json
          followers_count?: number
          following_count?: number
          loops_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      loops: {
        Row: {
          id: string
          author_id: string
          parent_loop_id: string | null
          content_type: 'text' | 'image' | 'video' | 'audio' | 'file'
          content_text: string | null
          content_media_url: string | null
          content_metadata: Json | null
          content_title: string | null
          content: Json | null
          visibility: 'public' | 'private' | 'circle'
          circle_id: string | null
          tree_depth: number
          hashtags: string[] | null
          created_at: string
          updated_at: string
          /** Quote rebranch: reference to the quoted post (never a copy). */
          quoted_loop_id?: string | null
          quote_count?: number | null
        }
        Insert: {
          id?: string
          author_id: string
          quoted_loop_id?: string | null
          quote_count?: number | null
          parent_loop_id?: string | null
          content_type: 'text' | 'image' | 'video' | 'audio' | 'file'
          content_text?: string | null
          content_media_url?: string | null
          content_metadata?: Json | null
          content_title?: string | null
          content?: Json | null
          visibility?: 'public' | 'private' | 'circle'
          circle_id?: string | null
          tree_depth?: number
          hashtags?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          quoted_loop_id?: string | null
          quote_count?: number | null
          parent_loop_id?: string | null
          content_type?: 'text' | 'image' | 'video' | 'audio' | 'file'
          content_text?: string | null
          content_media_url?: string | null
          content_metadata?: Json | null
          content_title?: string | null
          content?: Json | null
          visibility?: 'public' | 'private' | 'circle'
          circle_id?: string | null
          tree_depth?: number
          hashtags?: string[] | null
          created_at?: string
          updated_at?: string
        }
      }
      loop_stats: {
        Row: {
          loop_id: string
          likes_count: number
          comments_count: number
          branches_count: number
          shares_count: number
          views_count: number
          updated_at: string
        }
        Insert: {
          loop_id: string
          likes_count?: number
          comments_count?: number
          branches_count?: number
          shares_count?: number
          views_count?: number
          updated_at?: string
        }
        Update: {
          loop_id?: string
          likes_count?: number
          comments_count?: number
          branches_count?: number
          shares_count?: number
          views_count?: number
          updated_at?: string
        }
      }
      loop_interactions: {
        Row: {
          id: string
          user_id: string
          loop_id: string
          interaction_type: 'like' | 'save' | 'view' | 'share'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          loop_id: string
          interaction_type: 'like' | 'save' | 'view' | 'share'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          loop_id?: string
          interaction_type?: 'like' | 'save' | 'view' | 'share'
          created_at?: string
        }
      }
      comments: {
        Row: {
          id: string
          loop_id: string
          author_id: string
          content: string
          parent_comment_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          loop_id: string
          author_id: string
          content: string
          parent_comment_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          loop_id?: string
          author_id?: string
          content?: string
          parent_comment_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      follows: {
        Row: {
          id: string
          follower_id: string
          following_id: string
          created_at: string
        }
        Insert: {
          id?: string
          follower_id: string
          following_id: string
          created_at?: string
        }
        Update: {
          id?: string
          follower_id?: string
          following_id?: string
          created_at?: string
        }
      }
      circles: {
        Row: {
          id: string
          name: string
          description: string | null
          avatar_url: string | null
          banner_url: string | null
          is_private: boolean
          owner_id: string
          member_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          avatar_url?: string | null
          banner_url?: string | null
          is_private?: boolean
          owner_id: string
          member_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          avatar_url?: string | null
          banner_url?: string | null
          is_private?: boolean
          owner_id?: string
          member_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      circle_members: {
        Row: {
          id: string
          circle_id: string
          user_id: string
          role: 'member' | 'moderator' | 'admin'
          joined_at: string
        }
        Insert: {
          id?: string
          circle_id: string
          user_id: string
          role?: 'member' | 'moderator' | 'admin'
          joined_at?: string
        }
        Update: {
          id?: string
          circle_id?: string
          user_id?: string
          role?: 'member' | 'moderator' | 'admin'
          joined_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string | null
          circle_id: string | null
          content: string
          message_type: 'text' | 'image' | 'file' | 'system'
          file_url: string | null
          reply_to_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id?: string | null
          circle_id?: string | null
          content: string
          message_type?: 'text' | 'image' | 'file' | 'system'
          file_url?: string | null
          reply_to_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sender_id?: string
          recipient_id?: string | null
          circle_id?: string | null
          content?: string
          message_type?: 'text' | 'image' | 'file' | 'system'
          file_url?: string | null
          reply_to_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: 'like' | 'comment' | 'follow' | 'branch' | 'mention' | 'system'
          title: string
          message: string
          data: Json | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'like' | 'comment' | 'follow' | 'branch' | 'mention' | 'system'
          title: string
          message: string
          data?: Json | null
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'like' | 'comment' | 'follow' | 'branch' | 'mention' | 'system'
          title?: string
          message?: string
          data?: Json | null
          is_read?: boolean
          created_at?: string
        }
      }
      shop_items: {
        Row: {
          id: string
          name: string
          description: string
          price: number
          price_coins: number | null
          price_usd: number | null
          category: 'theme' | 'animation' | 'effect' | 'premium' | 'coins'
          item_type: string
          rarity: 'common' | 'rare' | 'epic' | 'legendary'
          premium_only: boolean
          item_data: Json
          preview_data: Json | null
          metadata: Json | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          price?: number
          price_coins?: number | null
          price_usd?: number | null
          category: 'theme' | 'animation' | 'effect' | 'premium' | 'coins'
          item_type: string
          rarity?: 'common' | 'rare' | 'epic' | 'legendary'
          premium_only?: boolean
          item_data: Json
          preview_data?: Json | null
          metadata?: Json | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          price?: number
          price_coins?: number | null
          price_usd?: number | null
          category?: 'theme' | 'animation' | 'effect' | 'premium' | 'coins'
          item_type?: string
          rarity?: 'common' | 'rare' | 'epic' | 'legendary'
          premium_only?: boolean
          item_data?: Json
          preview_data?: Json | null
          metadata?: Json | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      user_inventory: {
        Row: {
          id: string
          user_id: string
          item_id: string
          is_active: boolean
          purchased_at: string
          purchase_price: number | null
          payment_method: string | null
        }
        Insert: {
          id?: string
          user_id: string
          item_id: string
          is_active?: boolean
          purchased_at?: string
          purchase_price?: number | null
          payment_method?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          item_id?: string
          is_active?: boolean
          purchased_at?: string
          purchase_price?: number | null
          payment_method?: string | null
        }
      }
      live_streams: {
        Row: {
          id: string
          streamer_id: string
          title: string
          description: string | null
          thumbnail_url: string | null
          stream_key: string
          rtmp_url: string | null
          hls_url: string | null
          status: 'preparing' | 'live' | 'ended' | 'paused'
          viewer_count: number
          max_viewers: number
          category: string | null
          tags: string[] | null
          is_premium_only: boolean
          chat_enabled: boolean
          gifts_enabled: boolean
          total_earnings: number
          started_at: string | null
          ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          streamer_id: string
          title: string
          description?: string | null
          thumbnail_url?: string | null
          stream_key?: string
          rtmp_url?: string | null
          hls_url?: string | null
          status?: 'preparing' | 'live' | 'ended' | 'paused'
          viewer_count?: number
          max_viewers?: number
          category?: string | null
          tags?: string[] | null
          is_premium_only?: boolean
          chat_enabled?: boolean
          gifts_enabled?: boolean
          total_earnings?: number
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          streamer_id?: string
          title?: string
          description?: string | null
          thumbnail_url?: string | null
          stream_key?: string
          rtmp_url?: string | null
          hls_url?: string | null
          status?: 'preparing' | 'live' | 'ended' | 'paused'
          viewer_count?: number
          max_viewers?: number
          category?: string | null
          tags?: string[] | null
          is_premium_only?: boolean
          chat_enabled?: boolean
          gifts_enabled?: boolean
          total_earnings?: number
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      stream_viewers: {
        Row: {
          id: string
          stream_id: string
          user_id: string
          joined_at: string
          left_at: string | null
          watch_time: number
        }
        Insert: {
          id?: string
          stream_id: string
          user_id: string
          joined_at?: string
          left_at?: string | null
          watch_time?: number
        }
        Update: {
          id?: string
          stream_id?: string
          user_id?: string
          joined_at?: string
          left_at?: string | null
          watch_time?: number
        }
      }
      stream_chat: {
        Row: {
          id: string
          stream_id: string
          user_id: string
          message: string
          message_type: 'text' | 'gift' | 'system'
          gift_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          stream_id: string
          user_id: string
          message: string
          message_type?: 'text' | 'gift' | 'system'
          gift_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          stream_id?: string
          user_id?: string
          message?: string
          message_type?: 'text' | 'gift' | 'system'
          gift_data?: Json | null
          created_at?: string
        }
      }
      gifts: {
        Row: {
          id: string
          name: string
          description: string
          icon_url: string
          animation_url: string | null
          price_coins: number
          rarity: 'common' | 'rare' | 'epic' | 'legendary'
          effects: Json | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          icon_url: string
          animation_url?: string | null
          price_coins: number
          rarity?: 'common' | 'rare' | 'epic' | 'legendary'
          effects?: Json | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          icon_url?: string
          animation_url?: string | null
          price_coins?: number
          rarity?: 'common' | 'rare' | 'epic' | 'legendary'
          effects?: Json | null
          is_active?: boolean
          created_at?: string
        }
      }
      gift_transactions: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string
          gift_id: string
          stream_id: string | null
          loop_id: string | null
          quantity: number
          total_cost: number
          message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id: string
          gift_id: string
          stream_id?: string | null
          loop_id?: string | null
          quantity?: number
          total_cost: number
          message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sender_id?: string
          recipient_id?: string
          gift_id?: string
          stream_id?: string | null
          loop_id?: string | null
          quantity?: number
          total_cost?: number
          message?: string | null
          created_at?: string
        }
      }
      earnings: {
        Row: {
          id: string
          user_id: string
          source_type: 'gift' | 'premium' | 'tip' | 'ad_revenue'
          source_id: string | null
          amount: number
          currency: 'coins' | 'usd'
          status: 'pending' | 'available' | 'withdrawn'
          created_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          source_type: 'gift' | 'premium' | 'tip' | 'ad_revenue'
          source_id?: string | null
          amount: number
          currency?: 'coins' | 'usd'
          status?: 'pending' | 'available' | 'withdrawn'
          created_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          source_type?: 'gift' | 'premium' | 'tip' | 'ad_revenue'
          source_id?: string | null
          amount?: number
          currency?: 'coins' | 'usd'
          status?: 'pending' | 'available' | 'withdrawn'
          created_at?: string
          processed_at?: string | null
        }
      }
      withdrawals: {
        Row: {
          id: string
          user_id: string
          amount: number
          currency: 'usd'
          method: 'paypal' | 'bank_transfer' | 'crypto'
          method_details: Json
          status: 'pending' | 'processing' | 'completed' | 'failed'
          transaction_id: string | null
          fees: number
          net_amount: number
          requested_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          currency?: 'usd'
          method: 'paypal' | 'bank_transfer' | 'crypto'
          method_details: Json
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          transaction_id?: string | null
          fees?: number
          net_amount: number
          requested_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          currency?: 'usd'
          method?: 'paypal' | 'bank_transfer' | 'crypto'
          method_details?: Json
          status?: 'pending' | 'processing' | 'completed' | 'failed'
          transaction_id?: string | null
          fees?: number
          net_amount?: number
          requested_at?: string
          processed_at?: string | null
        }
      }
      reels: {
        Row: {
          id: string
          author_id: string
          title: string
          description: string | null
          content_type: 'video' | 'image' | 'audio' | 'text'
          content_url: string | null
          thumbnail_url: string | null
          duration: number | null
          hashtags: string[] | null
          music_id: string | null
          effects: Json | null
          visibility: 'public' | 'private' | 'followers'
          allows_comments: boolean
          allows_duets: boolean
          allows_downloads: boolean
          view_count: number
          like_count: number
          comment_count: number
          share_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          author_id: string
          title: string
          description?: string | null
          content_type: 'video' | 'image' | 'audio' | 'text'
          content_url?: string | null
          thumbnail_url?: string | null
          duration?: number | null
          hashtags?: string[] | null
          music_id?: string | null
          effects?: Json | null
          visibility?: 'public' | 'private' | 'followers'
          allows_comments?: boolean
          allows_duets?: boolean
          allows_downloads?: boolean
          view_count?: number
          like_count?: number
          comment_count?: number
          share_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          title?: string
          description?: string | null
          content_type?: 'video' | 'image' | 'audio' | 'text'
          content_url?: string | null
          thumbnail_url?: string | null
          duration?: number | null
          hashtags?: string[] | null
          music_id?: string | null
          effects?: Json | null
          visibility?: 'public' | 'private' | 'followers'
          allows_comments?: boolean
          allows_duets?: boolean
          allows_downloads?: boolean
          view_count?: number
          like_count?: number
          comment_count?: number
          share_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      reel_interactions: {
        Row: {
          id: string
          user_id: string
          reel_id: string
          interaction_type: 'like' | 'view' | 'share' | 'save'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          reel_id: string
          interaction_type: 'like' | 'view' | 'share' | 'save'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          reel_id?: string
          interaction_type?: 'like' | 'view' | 'share' | 'save'
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_loop_likes: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      decrement_loop_likes: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      increment_loop_saves: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      decrement_loop_saves: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      increment_loop_shares: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      increment_loop_comments: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      increment_loop_branches: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      increment_loop_views: {
        Args: {
          loop_id: string
        }
        Returns: undefined
      }
      get_user_feed: {
        Args: {
          user_id: string
          feed_limit?: number
          feed_offset?: number
        }
        Returns: {
          loop_id: string
          author_id: string
          content_type: string
          content_text: string | null
          content_media_url: string | null
          created_at: string
          likes_count: number
          comments_count: number
          branches_count: number
          author_username: string
          author_display_name: string
          author_avatar_url: string | null
          is_liked: boolean
          is_saved: boolean
        }[]
      }
      get_trending_loops: {
        Args: {
          time_period?: string
          trend_limit?: number
          trend_offset?: number
        }
        Returns: {
          loop_id: string
          author_id: string
          content_type: string
          content_text: string | null
          content_media_url: string | null
          created_at: string
          likes_count: number
          comments_count: number
          branches_count: number
          trend_score: number
        }[]
      }
      kick_co_loop_participant: {
        Args: {
          p_session_id: string
          p_owner_id: string
          p_target_user_id: string
        }
        Returns: Json
      }
      respond_co_loop_invitation: {
        Args: {
          p_session_id: string
          p_invitee_id: string
          p_action: string
        }
        Returns: Json
      }
      create_co_loop_invitation: {
        Args: {
          p_session_id: string
          p_inviter_id: string
          p_invitee_id: string
        }
        Returns: Json
      }
      set_circle_event_rsvp_authorized: {
        Args: {
          p_event_id: string
          p_user_id: string
          p_actor_id: string
          p_status: string
        }
        Returns: Json
      }
      purchase_premium_with_coins: {
        Args: {
          p_user_id: string
          p_plan_type: string
          p_transaction_id: string
        }
        Returns: Json
      }
      review_verification_request: {
        Args: {
          p_request_id: string
          p_reviewer_id: string
          p_action: string
          p_admin_notes?: string | null
        }
        Returns: Json
      }
      submit_verification_appeal: {
        Args: {
          p_request_id: string
          p_user_id: string
          p_reason: string
          p_evidence_url?: string | null
        }
        Returns: Json
      }
      review_verification_appeal: {
        Args: {
          p_appeal_id: string
          p_reviewer_id: string
          p_action: string
          p_rejection_reason?: string | null
          p_admin_notes?: string | null
        }
        Returns: Json
      }
      review_content_flag: {
        Args: {
          p_flag_id: string
          p_moderator_id: string
          p_status: string
          p_action_taken?: string
          p_moderator_notes?: string | null
        }
        Returns: Json
      }
      review_ban_appeal: {
        Args: {
          p_appeal_id: string
          p_reviewer_id: string
          p_decision: string
          p_admin_notes?: string | null
        }
        Returns: Json
      }
      join_circle: {
        Args: {
          p_circle_id: string
          p_user_id: string
        }
        Returns: Json
      }
      review_circle_join_request: {
        Args: {
          p_circle_id: string
          p_member_id: string
          p_actor_id: string
          p_action: string
          p_role?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

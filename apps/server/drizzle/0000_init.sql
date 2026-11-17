CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"player_id" uuid,
	"match_id" uuid,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "escrow_transactions" (
	"signature" text PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"player_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"color" text NOT NULL,
	"wallet" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deposit_confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "match_participants_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "match_results" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"white_rating_before" integer NOT NULL,
	"white_rating_after" integer NOT NULL,
	"black_rating_before" integer NOT NULL,
	"black_rating_after" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"stake_tier" text NOT NULL,
	"stake_base_units" bigint NOT NULL,
	"time_control" text NOT NULL,
	"initial_ms" integer NOT NULL,
	"increment_ms" integer NOT NULL,
	"white_player_id" uuid NOT NULL,
	"black_player_id" uuid NOT NULL,
	"escrow_address" text NOT NULL,
	"vault_address" text NOT NULL,
	"mint" text NOT NULL,
	"adjudicator" text NOT NULL,
	"funding_deadline" timestamp with time zone NOT NULL,
	"fen" text NOT NULL,
	"white_ms" integer NOT NULL,
	"black_ms" integer NOT NULL,
	"turn_started_at" timestamp with time zone,
	"draw_offer_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_escrow_address_unique" UNIQUE("escrow_address")
);
--> statement-breakpoint
CREATE TABLE "matchmaking_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"elo" integer NOT NULL,
	"stake_tier" text NOT NULL,
	"time_control" text NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"match_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"match_id" uuid NOT NULL,
	"ply" integer NOT NULL,
	"san" text NOT NULL,
	"from_sq" text NOT NULL,
	"to_sq" text NOT NULL,
	"promotion" text,
	"fen_after" text NOT NULL,
	"white_ms" integer NOT NULL,
	"black_ms" integer NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moves_match_id_ply_pk" PRIMARY KEY("match_id","ply")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"username" text,
	"avatar" text DEFAULT 'knight' NOT NULL,
	"avatar_color" text DEFAULT 'violet' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"elo" integer DEFAULT 1200 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"last_faucet_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "players_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"before" integer NOT NULL,
	"after" integer NOT NULL,
	"delta" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_jobs" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"outcome" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"signature" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_white_player_id_players_id_fk" FOREIGN KEY ("white_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_black_player_id_players_id_fk" FOREIGN KEY ("black_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_queue" ADD CONSTRAINT "matchmaking_queue_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_jobs" ADD CONSTRAINT "settlement_jobs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_match_idx" ON "audit_logs" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "escrow_tx_match_idx" ON "escrow_transactions" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_one_active_match" ON "match_participants" USING btree ("player_id") WHERE "match_participants"."active";--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_one_waiting_per_player" ON "matchmaking_queue" USING btree ("player_id") WHERE "matchmaking_queue"."status" = 'WAITING';--> statement-breakpoint
CREATE INDEX "queue_waiting_idx" ON "matchmaking_queue" USING btree ("stake_tier","time_control","joined_at") WHERE "matchmaking_queue"."status" = 'WAITING';--> statement-breakpoint
CREATE UNIQUE INDEX "rating_once_per_match" ON "rating_history" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE INDEX "sessions_player_idx" ON "sessions" USING btree ("player_id");
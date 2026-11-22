CREATE TABLE "alert_state" (
	"village_code" text NOT NULL,
	"kind" text NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_state_village_code_kind_pk" PRIMARY KEY("village_code","kind")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"village_code" text,
	"village_codes" jsonb,
	"officer_id" integer,
	"title" text,
	"text_km" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communes" (
	"code" text PRIMARY KEY NOT NULL,
	"district_code" text NOT NULL,
	"name_km" text NOT NULL,
	"name_en" text NOT NULL,
	"lat" double precision,
	"lng" double precision
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"alert_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "deliveries_alert_id_user_id_pk" PRIMARY KEY("alert_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"code" text PRIMARY KEY NOT NULL,
	"province_code" text NOT NULL,
	"name_km" text NOT NULL,
	"name_en" text NOT NULL,
	"lat" double precision,
	"lng" double precision
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"commune_code" text,
	"role" text DEFAULT 'officer' NOT NULL,
	"org_name" text,
	"org_name_km" text,
	"area_codes" jsonb,
	CONSTRAINT "officers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"code" text PRIMARY KEY NOT NULL,
	"name_km" text NOT NULL,
	"name_en" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"weather_name" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" integer NOT NULL,
	"topic" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"threshold_pct" real,
	CONSTRAINT "subscriptions_user_id_topic_pk" PRIMARY KEY("user_id","topic")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"language" text DEFAULT 'km' NOT NULL,
	"village_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "villages" (
	"code" text PRIMARY KEY NOT NULL,
	"commune_code" text NOT NULL,
	"name_km" text NOT NULL,
	"name_en" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"forecast_location" text
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communes" ADD CONSTRAINT "communes_district_code_districts_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."districts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_province_code_provinces_code_fk" FOREIGN KEY ("province_code") REFERENCES "public"."provinces"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_commune_code_communes_code_fk" FOREIGN KEY ("commune_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_village_code_villages_code_fk" FOREIGN KEY ("village_code") REFERENCES "public"."villages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "villages" ADD CONSTRAINT "villages_commune_code_communes_code_fk" FOREIGN KEY ("commune_code") REFERENCES "public"."communes"("code") ON DELETE no action ON UPDATE no action;
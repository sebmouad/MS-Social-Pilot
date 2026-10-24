-- Baseline schema (lane 47, 2026-10-22): squash of the 140 reviewed
-- migrations below, concatenated verbatim in deploy ORDER (see
-- scripts/cutover-rehearsal.sh for the reviewed order). Production already
-- applied the old migrations: prod-deploy.sh marks this baseline as applied
-- without re-running it there (resolve semantics). Fresh databases apply this
-- file once, WITHOUT a wrapping transaction: it contains
-- ALTER TYPE ... ADD VALUE, which PostgreSQL forbids inside a transaction block.
-- Verify integrity with tests/baseline-migration.test.ts (per-source SHA-256).
--
-- Sources (name + SHA-256 of the original migration.sql):
--   20260810093237_init_postgres  19c72b6f7a863000a85aead9763ecb3a10755e455223e952139f5b8055253b1e
--   20260810142617_analytics_module  e7a2e72e7956758ab7cd28105b634dbdd621d431ea85254c78aad52d0c61deba
--   20260810183448_tier2_tier3_edges  6a975fe8177daebfe754c69b4a7bf8e0e63054eae7cc73e35e49cee646730085
--   20260811003638_app_settings  f1dd0fe5ae74f99ec88a4baf767711d9e7484b33ad62c1829f1e1aeb907e5b14
--   20260811074315_post_media_keys  f2d6c8c0eda32d0ed84085cbd4992513b3665ea7a0131f55d3f57fb7913753d9
--   20260811220702_instagram_target  edee59e8d25a90cc2d2e645e042c7bd7fe12f29f47575fa57bf49d8fca57b792
--   20260812070000_link_click_visitor_index  d760606cac0684708808e9a7d0723db7fd768147da191be1c82843cd790eec45
--   20260812090000_target_reviews_backfilled  3dc9c8a19d3278151b7f7b9670f594410f960062defe68524f821e1440f03db1
--   20260812100000_target_block_reason  6c20e84bf412c668bd1de90ef2487a0c88ccbc1b5bc30ef1cf27ccae9ab25e38
--   20260812140000_worker_heartbeat  7ca3c094849e70eb7516eef55b9c623d382e5598c529ae995d466196a3e4370c
--   20260929090000_instance_owner_and_indexes  94e8d81b1ac62feaf4ab10d967137bbf283a42a70178193e657730190d8f821d
--   20261010090000_first_comment  5229a7248fd2549d287250d876a7cb357b7f3fa9b2e59dd97c01d015ef01b335
--   20261010120000_external_post_picture  32f35e4e86cfe12c96604679fd6aab7294b59e3cf15dbb5f4754d8febc9d1b5e
--   20261010140000_worker_runs_and_missing_posts  6eb3ca53fc8cfcb6d03e5c563822f9601fcb4da3c2ffabbcb232772bc88777a3
--   20261011090000_page_groups_labels_access  fdd9471fea3cfc86fde42236b792bea882ad2c409714d4053a6cda8198b3474d
--   20261011150000_formats_snippets_sharing_reports  cb18371c7a709bfc5579ebb40cbb075229622868a6c1067939c6ebf8eb795c68
--   20261012031949_worker_status_graph_usage  c13029e9966f7f865757101b7b3c6755dbbc75447a2c1f072e4a680fb3dcb562
--   20261012032237_target_first_read  f9262ed3eb5788c3be7161f89ce52036330ff2c9de914fdc69c6a99490fd090a
--   20261012034047_workspace_week_start  aba9becfbf0ec8eb034f87e2456f62ca087975a04e42accab652e8ea1ab6024e
--   20261012034454_inbox_resolved  e7707529b2a3d3aa2350a308026fce08d32289e60875f9a28eb4b7c7b914024e
--   20261012035406_notification_matrix  1dbe137dab9477855357844e51e5194575c42cb33a7a3d94d1c693da96e5d8af
--   20261012035930_report_ai_recap  4889ce94473bb34d6cc1ba1f7d0867f8d3e52ec29cd6657afc6de445bbde347a
--   20261012050005_queue_empty_notice  de2899a94a91f1551e593eabfd7ba7a719b94b8be0a1b95e2967b9564432bf9f
--   20261012050443_draft_updated_notice  51967d33df9e0842b09cacaece30699f38aeacd96f3af80054e72ad8e9693daf
--   20261012052950_user_theme  1830346f4ad5c713759d085e037d628f464086b44b47914b6aebf9bf74802895
--   20261012054631_session_devices  0e909694b59ab1308159285e3c5fe8130df00e68049b37feb384798df3bf728f
--   20261012065921_feed_website_share  40f31b52f976e3b3554a2e2d093f7a60b9e1ae0ec299ab0ead82572f98710e86
--   20261012070327_spam_gap  3e6b25754c2512e7976e17691179125d51faaf792e82ac0b4dfcecb4016f5c1a
--   20261012082501_moderation_rules  ea6dc3bc3cf99441f400c7dc62c9890c9fcd0aef0c0cd0437795a7eb7b3c2eb3
--   20261012083846_saved_replies  8e12589b2aaff72134563784d9037a663af71df958a28e060d3bbc3b35532027
--   20261012085109_caption_tests  849572b34009052cbac20f46e5ac2cec00f46b84892bd13de28dc0cad4104a4b
--   20261012090000_api_tokens_chat_channels_page_voice  66da56a5563fa19b255202a514192e2fa6b7379e5cd9779b15aa2fa0cd1dedda
--   20261012090622_best_time_mode  687653e4f84d3596ea87d474e2c8b47f4e5dd99afd81051d0005155599e927e3
--   20261012091935_audience  13b7f3582855ce232cb4a86099022dc26d5c703797afeb998006e779d686838d
--   20261012093838_ai_translate  97003931814da94c446ca425f5b5e58ae2af55728b09380c3652635eb7228682
--   20261012100746_short_link_target  a8b7c9a6bd92154a6af8be88f55d4b4d783575686787c22853e945e364b063a7
--   20261012101604_uptime_days  375eee2f5dda7e3a24ba14b190a7332c8cc4b6b30f06db059b9fd763ae473247
--   20261012101918_error_events  641e5782bb183ddb31b1995dd613a502469d3cb0c3e1631739e1fb7769111891
--   20261012103124_workspace_exports  a2ccf6139ca2c68a9e85eaf6f1ef8a0a2c160c083dfc1c8b7df2ece7df881fc3
--   20261012104601_media_variants_watermark  db6f3ff260656ec0fe4f3c1da64e651fa82c6a431fb32f4ccce6d0a4b8a567b6
--   20261012105721_key_dates_seasons  7d09cb1e5282a587b519a5e4e40b083e97ee6876ef857dd45d0d80cad53c30a9
--   20261012120000_undo_send  191f2533a0c6e34d681f6b2f013a8139c58678e4de8e1b1c95cce7d46c3361e2
--   20261012130000_webhooks  4a5b2154d4c79ecfbd2c6b8dfd24c78f70e3ced6a469b3366ab39d1c36e2e400
--   20261012140000_content_mix  30d189e80238ab1bad70372f3f63e772ee574174711760d03097110b77e4ea32
--   20261012150000_other_networks  1e322d71f230e921a47f3845753a11af5ed1e547ed9f8ec3badf480440f80b50
--   20261012160000_post_templates  5590d6d3075f32ed91004d65b5a24771d6cecfd768b0eb23b49bde85d7be708f
--   20261012170000_post_target_removed_at  ae168effcaed45ecdffdec5286a02e6edd94c550e3d16d6c56e09c5d93be8114
--   20261012180000_post_versions  2850e64f3ffa97b0ed08f4d4e1be8776d2a5b5f207a6ad6a9e8f79ede95f11f0
--   20261012200000_post_notes  1c9b47fae3e6bfdcb7a99821cfe237611aea8e5eb4eddd429f075529fa694ead
--   20261012220000_calendar_feeds  8613b6e838e917be4a3f7af875bfdbb48a3eaf469b8ed4fed6567d26451b0770
--   20261013090000_ai_generation_cost  ea3851f6f1126cc30f6c38a9d1052014741eed2990f5c3b8c4078e344dfedd51
--   20261013090000_page_goals  49f90e442521d25d031076b9f1b31a0b89147738bb276cc6d5c4ecc728231769
--   20261013100000_root_section  4c1e0bdb6645f3d5cbc03b381ff1f0910e74e87628bbde266b29708c12d2546d
--   20261013110000_chart_notes  f6d642cfc6038e7e58c73e0198d39cbb92d636ddd038d2233b8364f64f2a6817
--   20261013110000_two_step  e8f745ee1c178287e5191b322bd5f6d82b3f6c4c67c4302b97a233cb51ab2aae
--   20261013120000_backup_runs  56bca95fa60ab7c4bd36e559580386120bf950994ebff39d7d0fab8039d8484a
--   20261013130000_inbox_response_time  62addc197fb19cdd760abffce2681b74943233c6ba6374374b587d9efbb8f5e7
--   20261013130000_system_alerts  fe8b414cc0eb47f4c8cf7b6f12bc61bdf6fc2014f9dcb0df8cfd69f6fcfa24f9
--   20261013140000_client_invitations  6bec812fdfb0b78c1bc0a35a02d26680f6125a025410138711141522338aea2d
--   20261014090000_root_modules  7ea057fcd4058f187013adb4d99809e20d72d6bfc4d637e44a875d17245e1c06
--   20261015090000_pinned_metrics  ce17639305c003cb32f3811b810701bddf5c89abcfe7e7cc9b9ae7ce696f0895
--   20261016090000_negative_comment_alert  a5dccf307e66cf884a6a15c648afcb732568eb3eb33a7b0ad4bace8432e953d5
--   20261016100000_trending_topics  f32efebe21db9d3390d4d0f045ea1338c86d5d0154c9dd17cd2ea6622fd0cb92
--   20261016110000_ai_alt_text  feae4148901564f2a1e2a2ef48d7d182b9e0ffd07a75d87007ffce48020d6de7
--   20261016120000_email_tokens  ddac77d64019d0c0daeb85dc89d7442c00004957bb1ae6f4be5d787981d7b8d5
--   20261017090000_developer_features  5b4d4c087cff261ebf96f6f517eca6f3150ab58af1571418e6a6f34414081672
--   20261017100000_viewer_role  a438f91ffa20f7d26eba8691107fe73926e4f00dbc580da0f019d3512fbe954b
--   20261017110000_client_role  826e1a7330a9f537b88eacd34f9b7e50548f1e75355bf9fc676621ca749d0527
--   20261017120000_share_link_decides  ba3fbbc271d4c8a74f2f45ffef196b50c22c6e471f5aecffd18b81da5e6f18b4
--   20261017130000_plans  cc4d9bb8cdf1b74929d56b7f8185683e2cbcc3f079ef1660005890c2997f244e
--   20261018120000_telegram  67ee49f9b302770454e0ff34ded8de424b71a29d7c725b3f8ad12892b4c2537a
--   20261018130000_youtube  44b1fabca320240db3942c94fa708be481212bbab856d3d23ab380228ca436ad
--   20261018140000_tiktok  39efb3bf02843273d367b88a528e12e2172024021327bcdff6ac2d304176405f
--   20261019090000_saved_views  8db9a5758c44c5b7170db32edcc3eb4293f2a3998f3007ce86bc8fa2bef43683
--   20261019100000_inbox_assignee  407392b0061fdef4a62510eda287de8960dc0f13abe895c82a200f2882b5866b
--   20261019110000_post_target_message_override  212ba08986a78b554e0ef657cce60730db5d8bf9f9ad67a4c1a8a9d14e78577f
--   20261019120000_inbox_notes  672b27a1ae6043bf86bb62cc08fbb225cfd2a1d00ee20a487b1a843d73bf48b7
--   20261019130000_bio_page  6ab8aa72a42bf30b70a1c4f68bab2cfa1f845025a8c74b5b3622317997abd93f
--   20261019140000_ai_avoid_words  5191c7dfb49f4994bf9e7c723f3cc0b1a24377ea4638d811d273a9796138472d
--   20261019150000_tasks  b2454c2408fac409d84c1077656d90f3a84e245a91fcb899fa2682b213ac46e7
--   20261019160000_post_target_skip_media  fd5ab020e603481229a052d599bb880c5bf38fa0f332e6e1783b092547ab8b47
--   20261019170000_custom_fields  ffa0d1d6b7d0185dbdc183e46d587d698a3746613a8652c9dea8d949709c4360
--   20261019180000_client_approval_step  031284fc863689ab4807f14a9a94fa7523fdbe2d91edf0bac8cf70cc546d5fdd
--   20261019190000_ai_image_kind  e5b188707c823e599c0473eb60f0ec0b6e8a9f38c63d2ffd6ba0ab20220bd710
--   20261019200000_ai_agents  8f40ca0748ad570c365bf3293a7c2ba463461dffee2cff928b86edd676001232
--   20261020100000_post_place  dafea0f0feed49e2e09449b91199bf80e7e14b791f80a85b2ed8301c02eca5b9
--   20261020110000_post_text_background  dd468df943f8948a083358afca1ccd124e1668bbc2ca3aca25346d727beaac84
--   20261020120000_ai_videos  09e34187895ee98a7e50457e89109661b9d47c2e3f06244fca2c0971b42570e9
--   20261020130000_ai_voice_kind  1aeca1314c51d71825dbd43f5f1f9da624d955be7361d6b92f77d0483bf26757
--   20261021100000_oauth_connector  40cb48ce755b3b64d5b45edee1164671e7b92cb3854eff94fc7bf4a62701fb7a
--   20261022100000_changelog  47ce1a91528bd9263f66252dcc43bc6c99ee82e7c99a6a5427dd598fcf3d5869
--   20261022200000_root_admin_settings  d6f57204f010bff549284a785e77df3a98305c2fea1b07989dfda5fea6b07c75
--   20261024100000_workspace_data_purges  0f32e4ae733c07e8796babfa6e38ceddf0184fa240d1ae2e3d971643fc74a54e
--   20261101120000_ads_object_inventory  a6ea92c28d7697c4d229c6c90e068cc6da6b1d5575864b43e1d0976a31b50861
--   20261015120000_mcp_api_keys  988d873c33229b439818d079d72c8bc49ffec93cbfe081ee4061ef93d2b2b3f4
--   20261023100000_rebuild_worker_jobs  5fb7962a2c720f8a3f30480c4c5afa6f0d48c92a8f2ee58047fb96ccf04a7205
--   20261016190000_rebuild_inbox_deletions  457327ad55d02af41eefe00f56021923abe5e13cf7ca668a96c064fa714acc57
--   20261016220000_rebuild_post_deletions  80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07
--   20261017010000_rebuild_publication_attempts  03973b6fb80dcf2580c5e39f0d2be8fd5715f47c1a953127ce939638bfece267
--   20261017020000_rebuild_facebook_media_steps  897464050aedf8c727fd695cc9b1fead0810d6c08606f3074c4d70529940a0e1
--   20261017030000_rebuild_facebook_media_deletions  3f5df63bf339fe532581f14738d089ca5f20a4c245f581f1587573b5bfe6cca5
--   20261017040000_rebuild_facebook_media_resolution  3227fbe5f381a25c87955ac809ef605fe1f2d51d9bb4f3ca4e5e9ce743c2a844
--   20261018150000_rebuild_notifications  b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067
--   20261018170000_rebuild_ads_operations  61f575314590e45e8eafc7cb8088677fec2a78b39210b82187b6f2c05197d6d2
--   20261018190000_rebuild_ads_creation  749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0
--   20261018193000_rebuild_purge_write_gates  5250ec9a2e1176d59f8dd97b6b86d622187b87bd2d3944c41c7a411d157b51d6
--   20261025100000_rebuild_task_comments  648427469b965c3c5572b131c4834f772f1fdfe6884a0fd8c32aebc3588750ea
--   20261018230000_rebuild_sharing_expiry  28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263
--   20261018233000_rebuild_mcp_resource_scope  465a5d76679b45d7cb3fa6560b9d6a32501e56faab1922107547452a0b5519ab
--   20261019010000_rebuild_report_runs  caa0c553569cf9f984e973ceb6e3ee858750209c6d2931e1316d3323b4357c4a
--   20261019011000_rebuild_report_purge_gate  122e813070361737ba1a89d775d2f92922dadd36423debb83411e0d5a4aa5d9e
--   20261019020000_rebuild_destination_formats  30325cdda1951cde93fab77a12bc349caa4422861fe133f68320ac3b979af6c6
--   20261019030000_rebuild_facebook_native_journal  3ef505dccb5156ea1d84472998d19fb8427b1232669f57ca98a8ac6cd1e04d46
--   20261019040000_rebuild_facebook_native_status_proofs  253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4
--   20261019050000_rebuild_publication_submissions  91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931
--   20261019060000_rebuild_template_comment_delay  4c2f5699a826b8008003718084ee13eb0e4ee37e8e861ffdaf4a8a0a292bcfc5
--   20261026100000_rebuild_oauth_connectors  58514dc2c438333ac8fb74d632254e230d1d8e69967cc61b2076676eba9879d5
--   20261027100000_rebuild_workspace_exports  1d154d62c8422a6f8ac99a92c2975da9e7d211dc018950cc4f3a411c4e96acac
--   20261028100000_rebuild_alert_delivery  ed079e77ebb54ab01b46811686237c72308a11e43b75dfc9b9c9b0304801f36b
--   20261029100000_rebuild_channel_profiles  eaad76b014a355047385425fee74caa5fd656c942f461016f98b96c32142f7f4
--   20261030100000_rebuild_facebook_native_story_proofs  a74d6f4c546dd7f36f464636171bfe61d850dc42cca7786340c0169119fc680e
--   20261030100000_rebuild_review_resolution  bf99bb579b7d989d3ec1ec2651d8db216cbcaa44d8fe7d0e10ccb1448e08e68e
--   20261030110000_rebuild_ads_creative_creation  2109fc4f75cf1f528a6940a14979b1a5b60e6b79f3d9f269dc19507001703aec
--   20261030120000_rebuild_workspace_watermark  c950bc2f869e81840eb4dc9d06d5749559855ca40556b1e955203d5cfd6a30ce
--   20261030130000_rebuild_comment_sentiment  a617901b60682c7200d5e8d561df615ac2302ef1fe0677fe246e7dba38b093e4
--   20261030130000_rebuild_person_mcp_keys  ce14b0b7867c5a86a1c92290c173462964bd081213b90b037314f6dc64d789ff
--   20261030140000_rebuild_facebook_native_schedule_changes  08e1dd1d976c8dfc97207847a47fe8e671f2eeaf5987f9ab9272f9d00c17886e
--   20261031100000_rebuild_destination_schedule_mode  19fb66c945d4610accd4712bf769147409f5ba8a33632f360ec8c7d88671339b
--   20261031120000_rebuild_facebook_sync_cursors  d7226dcf14f8c673e39de1d441e6f6bb1271d993c4bec263f20aabe12e24028e
--   20261031140000_rebuild_wordpress_sources  cce64edcfbcf19553f7eafe661f86fb067d8d0152e08712d05dc1745121c4642
--   20261022180000_rebuild_uptime_samples  20fe4458ee87befda8eec716968b3c7717e44fe94619f19bfb7170c01c9fab11
--   20261022190000_rebuild_chat_deliveries  758df8d7f9d3716776bb501a54c2a5ab41e365ed5ef210429e8e87bbe60b41cf
--   20261031150000_rebuild_supplementary_purge_gates  f3f22b82d60a3bbbbacd5b152b3ceb577a3d39d126fd0ecdc09151e106f09768
--   20261031160000_rebuild_read_path_indexes  afada5e8886f5b725e5ba1907315048ccb11b6d9c300939d649220c9b9638762
--   20261031170000_rebuild_inbox_metadata  0f64264b7fbdb9108ffd77fd4dff7b8a233d6c227ec6a57652b9f88c8f63f870
--   20261031170000_rebuild_search_trigrams  2a5c27ac493fedbed7174ebb1c2bab19d0f33f220a341cb23b271f42e5cf572e
--   20261031180000_rebuild_ads_ad_creation  1769fa24129e6d74119e84d0677a2baf0c935cb73a4e722ae0a443b7fbc7120f
--   20261101100000_rebuild_writing_agents  e70e49f442d3fadde389b6f6990898ab60e157d1617da55080a06dee3c18525e
--   20261101100100_rebuild_post_exports  e5f8825c4bbe5e153da3a56bd18fd3d6668d0ea2765930f9a20afd396d9ce53c
--   20261102120000_rebuild_inbox_note_mentions  59d5aed5183c5bb7a59832abf7692d85a1259b9d14ee0c891fb02a8c441fe817

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'editor', 'contributor');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('page', 'group');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "PostTargetStatus" AS ENUM ('pending', 'processing', 'published', 'scheduled_remote', 'failed', 'cancelled', 'skipped');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('immediate', 'worker', 'native');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('local', 's3');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'fr');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AiGenerationKind" AS ENUM ('generate', 'improve');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "lastActiveWorkspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultLocale" "Locale" NOT NULL DEFAULT 'en',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "accentColor" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaignTemplate" TEXT,
    "shortenerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiTone" TEXT,
    "aiBrandVoice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'contributor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'contributor',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'facebook',
    "providerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pictureUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL DEFAULT '',
    "invalidatedAt" TIMESTAMP(3),
    "invalidReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "expiryWarningSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "type" "TargetType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pictureUrl" TEXT,
    "category" TEXT,
    "accessToken" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "canPublish" BOOLEAN NOT NULL DEFAULT true,
    "publishBlocker" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "linkPreview" JSONB,
    "media" JSONB NOT NULL DEFAULT '[]',
    "status" "PostStatus" NOT NULL DEFAULT 'draft',
    "publishMode" "PublishMode" NOT NULL DEFAULT 'worker',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "publishedAt" TIMESTAMP(3),
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'not_required',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "recycleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recycleEveryDays" INTEGER,
    "recycleLimit" INTEGER,
    "recycleCount" INTEGER NOT NULL DEFAULT 0,
    "recycleNextAt" TIMESTAMP(3),
    "originPostId" TEXT,
    "sourceFeedItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_targets" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "PostTargetStatus" NOT NULL DEFAULT 'pending',
    "remotePostId" TEXT,
    "remoteUrl" TEXT,
    "nativeScheduledFor" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'local',
    "storageKey" TEXT,
    "checksum" TEXT,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_slots" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "messageTemplate" TEXT NOT NULL DEFAULT '{{title}}

{{link}}',
    "targetIds" JSONB NOT NULL DEFAULT '[]',
    "publishMode" "PublishMode" NOT NULL DEFAULT 'worker',
    "autoApprove" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastEtag" TEXT,
    "lastModified" TEXT,
    "ingestFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pollErrorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feed_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_items" (
    "id" TEXT NOT NULL,
    "feedSourceId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "postId" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_clicks" (
    "id" TEXT NOT NULL,
    "shortLinkId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AiGenerationKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "onPublishFailure" BOOLEAN NOT NULL DEFAULT true,
    "onTokenExpiry" BOOLEAN NOT NULL DEFAULT true,
    "onApprovalRequest" BOOLEAN NOT NULL DEFAULT true,
    "onApprovalDecision" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "to" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "providerId" TEXT,
    "status" "EmailStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "memberships_workspaceId_idx" ON "memberships"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_workspaceId_key" ON "memberships"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_workspaceId_idx" ON "invitations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_workspaceId_email_key" ON "invitations"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "social_accounts_workspaceId_idx" ON "social_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspaceId_provider_providerUserId_key" ON "social_accounts"("workspaceId", "provider", "providerUserId");

-- CreateIndex
CREATE INDEX "targets_socialAccountId_idx" ON "targets"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "targets_workspaceId_providerId_key" ON "targets"("workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "posts_workspaceId_status_idx" ON "posts"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "posts_scheduledAt_idx" ON "posts"("scheduledAt");

-- CreateIndex
CREATE INDEX "posts_workspaceId_approvalStatus_idx" ON "posts"("workspaceId", "approvalStatus");

-- CreateIndex
CREATE INDEX "posts_recycleEnabled_recycleNextAt_idx" ON "posts"("recycleEnabled", "recycleNextAt");

-- CreateIndex
CREATE INDEX "post_targets_status_nextAttemptAt_idx" ON "post_targets"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "post_targets_targetId_idx" ON "post_targets"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "post_targets_postId_targetId_key" ON "post_targets"("postId", "targetId");

-- CreateIndex
CREATE INDEX "media_workspaceId_idx" ON "media"("workspaceId");

-- CreateIndex
CREATE INDEX "queue_slots_workspaceId_idx" ON "queue_slots"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_slots_workspaceId_dayOfWeek_hour_minute_key" ON "queue_slots"("workspaceId", "dayOfWeek", "hour", "minute");

-- CreateIndex
CREATE INDEX "feed_sources_workspaceId_idx" ON "feed_sources"("workspaceId");

-- CreateIndex
CREATE INDEX "feed_sources_enabled_lastPolledAt_idx" ON "feed_sources"("enabled", "lastPolledAt");

-- CreateIndex
CREATE INDEX "feed_items_feedSourceId_idx" ON "feed_items"("feedSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_items_feedSourceId_guid_key" ON "feed_items"("feedSourceId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "short_links_slug_key" ON "short_links"("slug");

-- CreateIndex
CREATE INDEX "short_links_workspaceId_idx" ON "short_links"("workspaceId");

-- CreateIndex
CREATE INDEX "short_links_postId_idx" ON "short_links"("postId");

-- CreateIndex
CREATE INDEX "link_clicks_shortLinkId_createdAt_idx" ON "link_clicks"("shortLinkId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_generations_workspaceId_createdAt_idx" ON "ai_generations"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_userId_workspaceId_key" ON "notification_settings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "email_logs_workspaceId_createdAt_idx" ON "email_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_workspaceId_createdAt_idx" ON "activity_logs"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_sourceFeedItemId_fkey" FOREIGN KEY ("sourceFeedItemId") REFERENCES "feed_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_slots" ADD CONSTRAINT "queue_slots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_feedSourceId_fkey" FOREIGN KEY ("feedSourceId") REFERENCES "feed_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_shortLinkId_fkey" FOREIGN KEY ("shortLinkId") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "fanCount" INTEGER,
ADD COLUMN     "followersCount" INTEGER,
ADD COLUMN     "profileSyncedAt" TIMESTAMP(3),
ADD COLUMN     "talkingAboutCount" INTEGER;

-- CreateTable
CREATE TABLE "page_insights" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "value" JSONB NOT NULL,
    "numeric" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_availability" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,
    "reason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_insights_targetId_metric_endTime_idx" ON "page_insights"("targetId", "metric", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_insights_targetId_metric_period_endTime_key" ON "page_insights"("targetId", "metric", "period", "endTime");

-- CreateIndex
CREATE INDEX "metric_availability_targetId_idx" ON "metric_availability"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_availability_targetId_metric_period_key" ON "metric_availability"("targetId", "metric", "period");

-- AddForeignKey
ALTER TABLE "page_insights" ADD CONSTRAINT "page_insights_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_availability" ADD CONSTRAINT "metric_availability_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "postTargetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "parentRemoteId" TEXT,
    "message" TEXT NOT NULL,
    "fromName" TEXT,
    "fromId" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_reviews" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "rating" INTEGER,
    "recommendationType" TEXT,
    "reviewText" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "snippet" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "participants" JSONB,
    "updatedTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "fromName" TEXT,
    "fromId" TEXT,
    "message" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_posts" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "message" TEXT,
    "permalink" TEXT,
    "statusType" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_videos" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "lengthSeconds" DOUBLE PRECISION,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "targetId" TEXT,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "followersCount" INTEGER,
    "followsCount" INTEGER,
    "mediaCount" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_media" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT,
    "mediaProductType" TEXT,
    "mediaUrl" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER,
    "commentsCount" INTEGER,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_insights" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "value" JSONB NOT NULL,
    "numeric" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "actId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "accountStatus" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_insights" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "objectName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "cpc" DOUBLE PRECISION,
    "cpm" DOUBLE PRECISION,
    "cpp" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "frequency" DOUBLE PRECISION,
    "actions" JSONB,
    "fields" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_comments_postTargetId_createdTime_idx" ON "post_comments"("postTargetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "post_comments_postTargetId_remoteId_key" ON "post_comments"("postTargetId", "remoteId");

-- CreateIndex
CREATE INDEX "page_reviews_targetId_createdTime_idx" ON "page_reviews"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_reviews_targetId_remoteId_key" ON "page_reviews"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "conversations_targetId_updatedTime_idx" ON "conversations"("targetId", "updatedTime");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_targetId_remoteId_key" ON "conversations"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_createdTime_idx" ON "conversation_messages"("conversationId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_remoteId_key" ON "conversation_messages"("conversationId", "remoteId");

-- CreateIndex
CREATE INDEX "external_posts_targetId_createdTime_idx" ON "external_posts"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "external_posts_targetId_remoteId_key" ON "external_posts"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "page_videos_targetId_createdTime_idx" ON "page_videos"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_videos_targetId_remoteId_key" ON "page_videos"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "instagram_accounts_workspaceId_idx" ON "instagram_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_workspaceId_igUserId_key" ON "instagram_accounts"("workspaceId", "igUserId");

-- CreateIndex
CREATE INDEX "instagram_media_accountId_timestamp_idx" ON "instagram_media"("accountId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_media_accountId_remoteId_key" ON "instagram_media"("accountId", "remoteId");

-- CreateIndex
CREATE INDEX "instagram_insights_accountId_metric_endTime_idx" ON "instagram_insights"("accountId", "metric", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_insights_accountId_metric_period_endTime_key" ON "instagram_insights"("accountId", "metric", "period", "endTime");

-- CreateIndex
CREATE INDEX "ad_accounts_workspaceId_idx" ON "ad_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_workspaceId_actId_key" ON "ad_accounts"("workspaceId", "actId");

-- CreateIndex
CREATE INDEX "ad_insights_adAccountId_date_idx" ON "ad_insights"("adAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insights_adAccountId_level_objectId_date_key" ON "ad_insights"("adAccountId", "level", "objectId", "date");

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_reviews" ADD CONSTRAINT "page_reviews_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_posts" ADD CONSTRAINT "external_posts_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_videos" ADD CONSTRAINT "page_videos_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_insights" ADD CONSTRAINT "instagram_insights_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_insights" ADD CONSTRAINT "ad_insights_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "posts_mediaKeys_idx" ON "posts" USING GIN ("mediaKeys");

-- Backfill from the existing Json payload, so posts written before this
-- column existed are still found by a media lookup. Both the id and the
-- storage key go in: a re-upload of the same bytes reuses the key while the
-- row id changes, and either one identifies the file.
UPDATE "posts" AS p
SET "mediaKeys" = COALESCE(k.keys, ARRAY[]::text[])
FROM (
  SELECT
    p2.id AS post_id,
    ARRAY(
      SELECT DISTINCT ref
      FROM jsonb_array_elements(p2.media::jsonb) AS item,
           LATERAL (VALUES (item ->> 'id'), (item ->> 'storageKey')) AS candidates(ref)
      WHERE ref IS NOT NULL
    ) AS keys
  FROM "posts" p2
  WHERE jsonb_typeof(p2.media::jsonb) = 'array'
) AS k
WHERE p.id = k.post_id;

-- AlterEnum
ALTER TYPE "TargetType" ADD VALUE 'instagram';

-- A click is one visitor arriving, not one page load. Recording one now asks
-- whether the same visitor already followed this link a moment ago, and this
-- index is what makes that question cheap.
CREATE INDEX "link_clicks_shortLinkId_ipHash_createdAt_idx"
  ON "link_clicks"("shortLinkId", "ipHash", "createdAt");

-- One ratings fetch reaches five hundred reviews. A Page with more is read
-- over several syncs, each ending where the last one started, and its average
-- rating is computed from a partial set until the walk reaches the beginning.
-- This records that it has.
ALTER TABLE "targets" ADD COLUMN "reviewsBackfilled" BOOLEAN NOT NULL DEFAULT false;

-- The reason a destination cannot publish, as a code rather than a sentence.
-- The sentence is written by a background job that cannot know who will read
-- it, and half this product's audience reads French. `publishBlocker` keeps
-- the English text as a fallback for rows written before this column existed.
ALTER TABLE "targets" ADD COLUMN "publishBlockerCode" TEXT;

-- One row per running scheduler worker, so the setup screen can tell an
-- installation whose worker has never been started from one that is working.
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobs" TEXT[],

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "worker_heartbeats_seenAt_idx" ON "worker_heartbeats"("seenAt");

-- Instance-wide configuration used to be gated on "owner of the active
-- workspace", and everybody who registers owns a workspace of their own. The
-- flag names the one person who installed the server instead.
ALTER TABLE "users" ADD COLUMN     "isInstanceOwner" BOOLEAN NOT NULL DEFAULT false;

-- An existing installation keeps working: the owner of the oldest workspace is
-- the person who set it up, and failing that (no workspace at all) the oldest
-- account. Exactly one row, so this never promotes a second person.
UPDATE "users" SET "isInstanceOwner" = true
WHERE "id" = COALESCE(
  (
    SELECT m."userId"
    FROM "memberships" m
    JOIN "workspaces" w ON w."id" = m."workspaceId"
    WHERE m."role" = 'owner'
    ORDER BY w."createdAt" ASC, m."createdAt" ASC
    LIMIT 1
  ),
  (SELECT "id" FROM "users" ORDER BY "createdAt" ASC LIMIT 1)
);

-- Invitations are looked up by address at sign-up, across workspaces.
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- The media library lists newest first within a workspace.
CREATE INDEX "media_workspaceId_createdAt_idx" ON "media"("workspaceId", "createdAt");

-- The insights sync picks published targets by how long ago they were read.
CREATE INDEX "post_targets_status_insightsSyncedAt_idx" ON "post_targets"("status", "insightsSyncedAt");

-- The calendar and the queue read a workspace's posts by date.
CREATE INDEX "posts_workspaceId_scheduledAt_idx" ON "posts"("workspaceId", "scheduledAt");

-- Foreign keys Postgres does not index on its own; without these, deleting a
-- user, a recycled original or a feed item scans every post.
CREATE INDEX "posts_authorId_idx" ON "posts"("authorId");

CREATE INDEX "posts_originPostId_idx" ON "posts"("originPostId");

CREATE INDEX "posts_sourceFeedItemId_idx" ON "posts"("sourceFeedItemId");

-- A first comment, posted as the Page under the post when it goes out.
ALTER TABLE "posts" ADD COLUMN "firstComment" TEXT;

-- Per destination: the comment Facebook accepted, when it was last attempted
-- (the claim against commenting twice), and why it was refused.
ALTER TABLE "post_targets" ADD COLUMN "firstCommentId" TEXT,
ADD COLUMN "firstCommentAt" TIMESTAMP(3),
ADD COLUMN "firstCommentError" TEXT;

-- The picture Facebook shows with a post found on the Page.
ALTER TABLE "external_posts" ADD COLUMN "pictureUrl" TEXT;

-- A post Facebook no longer has, so the syncs stop asking about it.
ALTER TABLE "post_targets" ADD COLUMN "remoteMissingAt" TIMESTAMP(3);

-- When each background job last finished, kept across worker restarts.
CREATE TABLE "worker_job_runs" (
    "name" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_job_runs_pkey" PRIMARY KEY ("name")
);

-- DropIndex
DROP INDEX "queue_slots_workspaceId_dayOfWeek_hour_minute_key";

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "allPages" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "queue_slots" ADD COLUMN     "targetId" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "reportFooter" TEXT,
ADD COLUMN     "reportSubtitle" TEXT,
ADD COLUMN     "reportTitle" TEXT;

-- CreateTable
CREATE TABLE "page_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_group_targets" (
    "groupId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "page_group_targets_pkey" PRIMARY KEY ("groupId","targetId")
);

-- CreateTable
CREATE TABLE "member_page_access" (
    "membershipId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "member_page_access_pkey" PRIMARY KEY ("membershipId","targetId")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_labels" (
    "postId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "post_labels_pkey" PRIMARY KEY ("postId","labelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_groups_workspaceId_name_key" ON "page_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "page_group_targets_targetId_idx" ON "page_group_targets"("targetId");

-- CreateIndex
CREATE INDEX "member_page_access_targetId_idx" ON "member_page_access"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_workspaceId_name_key" ON "labels"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "post_labels_labelId_idx" ON "post_labels"("labelId");

-- CreateIndex
CREATE INDEX "queue_slots_targetId_idx" ON "queue_slots"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_slots_workspaceId_targetId_dayOfWeek_hour_minute_key" ON "queue_slots"("workspaceId", "targetId", "dayOfWeek", "hour", "minute");

-- AddForeignKey
ALTER TABLE "queue_slots" ADD CONSTRAINT "queue_slots_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_groups" ADD CONSTRAINT "page_groups_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_group_targets" ADD CONSTRAINT "page_group_targets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "page_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_group_targets" ADD CONSTRAINT "page_group_targets_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_page_access" ADD CONSTRAINT "member_page_access_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_page_access" ADD CONSTRAINT "member_page_access_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_labels" ADD CONSTRAINT "post_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A time every Page shares has no targetId, and Postgres treats NULLs as
-- distinct in a unique index. This one makes the shared times unique too.
CREATE UNIQUE INDEX "queue_slots_shared_time_key" ON "queue_slots"("workspaceId", "dayOfWeek", "hour", "minute") WHERE "targetId" IS NULL;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'post';

-- CreateTable
CREATE TABLE "snippets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snippets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetIds" JSONB NOT NULL DEFAULT '[]',
    "daysBack" INTEGER NOT NULL DEFAULT 7,
    "daysAhead" INTEGER NOT NULL DEFAULT 30,
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "rangeKey" TEXT NOT NULL DEFAULT '30d',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT,
    "targetId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT[],
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snippets_workspaceId_idx" ON "snippets"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "share_links_workspaceId_idx" ON "share_links"("workspaceId");

-- CreateIndex
CREATE INDEX "review_decisions_postId_idx" ON "review_decisions"("postId");

-- CreateIndex
CREATE INDEX "review_decisions_shareLinkId_idx" ON "review_decisions"("shareLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_workspaceId_name_key" ON "report_templates"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "report_schedules_nextRunAt_idx" ON "report_schedules"("nextRunAt");

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "worker_job_runs" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ALTER COLUMN "finishedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "graph_usage" (
    "key" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_usage_pkey" PRIMARY KEY ("key")
);


-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "firstReadAt" TIMESTAMP(3);


-- Pages connected before this column existed have been read by the regular
-- jobs already; only Pages connected from now on wait for a first read.
UPDATE "targets" SET "firstReadAt" = CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "weekStartsOn" INTEGER NOT NULL DEFAULT 1;


-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "resolvedAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "inboxDigestAt" TIMESTAMP(3),
ADD COLUMN     "onNewInbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "notification_mutes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "event" TEXT NOT NULL,

    CONSTRAINT "notification_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_mutes_targetId_event_idx" ON "notification_mutes"("targetId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "notification_mutes_userId_targetId_event_key" ON "notification_mutes"("userId", "targetId", "event");

-- AddForeignKey
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'recap';

-- AlterTable
ALTER TABLE "report_schedules" ADD COLUMN     "aiRecap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdById" TEXT;


-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onQueueEmpty" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "queueEmptyNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "queueFilledAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onDraftUpdated" BOOLEAN NOT NULL DEFAULT true;


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'facebook';


-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "country" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "knownDevices" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- AlterTable
ALTER TABLE "feed_sources" ADD COLUMN     "hashtags" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'rss',
ADD COLUMN     "spreadMinutes" INTEGER NOT NULL DEFAULT 0;


-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "spamGapMinutes" INTEGER NOT NULL DEFAULT 20;


-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onModerationAlert" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "moderation_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "replyText" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "oncePerUser" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteCommentId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "replyRemoteId" TEXT,
    "error" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_rules_workspaceId_idx" ON "moderation_rules"("workspaceId");

-- CreateIndex
CREATE INDEX "moderation_actions_workspaceId_createdAt_idx" ON "moderation_actions"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_actions_ruleId_createdAt_idx" ON "moderation_actions"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_actions_ruleId_remoteCommentId_key" ON "moderation_actions"("ruleId", "remoteCommentId");

-- AddForeignKey
ALTER TABLE "moderation_rules" ADD CONSTRAINT "moderation_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "moderation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "saved_replies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_replies_workspaceId_idx" ON "saved_replies"("workspaceId");

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "captionLabel" TEXT,
ADD COLUMN     "captionTestId" TEXT;

-- CreateTable
CREATE TABLE "caption_tests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hours" INTEGER NOT NULL DEFAULT 48,
    "minViews" INTEGER NOT NULL DEFAULT 500,
    "status" TEXT NOT NULL DEFAULT 'running',
    "reason" TEXT,
    "winnerLabel" TEXT,
    "lift" DOUBLE PRECISION,
    "results" JSONB,
    "decidedAt" TIMESTAMP(3),
    "learnedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caption_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caption_tests_workspaceId_createdAt_idx" ON "caption_tests"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "caption_tests_status_idx" ON "caption_tests"("status");

-- CreateIndex
CREATE INDEX "posts_captionTestId_idx" ON "posts"("captionTestId");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_captionTestId_fkey" FOREIGN KEY ("captionTestId") REFERENCES "caption_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caption_tests" ADD CONSTRAINT "caption_tests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiGenerationKind" ADD VALUE 'hashtags';
ALTER TYPE "AiGenerationKind" ADD VALUE 'plan';

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "brandVoice" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_channels" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_workspaceId_idx" ON "api_tokens"("workspaceId");

-- CreateIndex
CREATE INDEX "chat_channels_workspaceId_idx" ON "chat_channels"("workspaceId");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "bestTimeMode" TEXT NOT NULL DEFAULT 'suggest',
ADD COLUMN     "bestTimesRunAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "audienceCalendars" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceTimezone" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "audienceCalendars" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceTimezone" TEXT;


-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'translate';


-- AlterTable
ALTER TABLE "short_links" ADD COLUMN     "targetId" TEXT;

-- CreateIndex
CREATE INDEX "short_links_targetId_idx" ON "short_links"("targetId");

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "uptime_days" (
    "day" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "uptime_days_pkey" PRIMARY KEY ("day","component")
);


-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "location" TEXT,
    "release" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_events_fingerprint_key" ON "error_events"("fingerprint");

-- CreateIndex
CREATE INDEX "error_events_lastSeenAt_idx" ON "error_events"("lastSeenAt");


-- CreateTable
CREATE TABLE "workspace_exports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "storageKey" TEXT,
    "bytes" INTEGER,
    "skippedMedia" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "workspace_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_exports_workspaceId_createdAt_idx" ON "workspace_exports"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_exports_status_idx" ON "workspace_exports"("status");

-- AddForeignKey
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "media" ADD COLUMN     "derivedFromId" TEXT,
ADD COLUMN     "variant" TEXT;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "watermark" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "media_derivedFromId_variant_key" ON "media"("derivedFromId", "variant");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "public_holidays" (
    "country" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localName" TEXT NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("country","date","name")
);

-- CreateTable
CREATE TABLE "holiday_years" (
    "country" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_years_pkey" PRIMARY KEY ("country","year")
);

-- CreateTable
CREATE TABLE "key_dates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "yearly" BOOLEAN NOT NULL DEFAULT false,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_modes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rule" TEXT NOT NULL,
    "shiftMinutes" INTEGER NOT NULL DEFAULT 0,
    "extraTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasonal_modes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_holidays_date_idx" ON "public_holidays"("date");

-- CreateIndex
CREATE INDEX "key_dates_workspaceId_date_idx" ON "key_dates"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "seasonal_modes_workspaceId_idx" ON "seasonal_modes"("workspaceId");

-- AddForeignKey
ALTER TABLE "key_dates" ADD CONSTRAINT "key_dates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_modes" ADD CONSTRAINT "seasonal_modes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "undoSendSeconds" INTEGER NOT NULL DEFAULT 30;


-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "apiTokenId" TEXT,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspaceId_idx" ON "webhook_endpoints"("workspaceId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "mixAutoFill" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "content_mix_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT,
    "groupId" TEXT,
    "labelId" TEXT NOT NULL,
    "perWeek" INTEGER NOT NULL,
    "dryNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_mix_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_mix_rules_workspaceId_idx" ON "content_mix_rules"("workspaceId");

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "page_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_mix_rules" ADD CONSTRAINT "content_mix_rules_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TargetType" ADD VALUE 'bluesky';
ALTER TYPE "TargetType" ADD VALUE 'mastodon';
ALTER TYPE "TargetType" ADD VALUE 'linkedin';
ALTER TYPE "TargetType" ADD VALUE 'threads';
ALTER TYPE "TargetType" ADD VALUE 'x';
ALTER TYPE "TargetType" ADD VALUE 'pinterest';

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "refreshToken" TEXT;


-- CreateTable
CREATE TABLE "post_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL DEFAULT '',
    "firstComment" TEXT NOT NULL DEFAULT '',
    "labelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_templates_workspaceId_name_key" ON "post_templates"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "post_templates" ADD CONSTRAINT "post_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_templates" ADD CONSTRAINT "post_templates_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "post_targets" ADD COLUMN     "removedAt" TIMESTAMP(3);


-- CreateTable
CREATE TABLE "post_versions" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "firstComment" TEXT,
    "link" TEXT,
    "media" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,

    CONSTRAINT "post_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_versions_postId_createdAt_idx" ON "post_versions"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_versions_authorId_idx" ON "post_versions"("authorId");

-- AddForeignKey
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onNoteMention" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "post_notes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "mentionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_notes_postId_createdAt_idx" ON "post_notes"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_notes_authorId_idx" ON "post_notes"("authorId");

-- AddForeignKey
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_notes" ADD CONSTRAINT "post_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_tokenHash_key" ON "calendar_feeds"("tokenHash");

-- CreateIndex
CREATE INDEX "calendar_feeds_workspaceId_userId_idx" ON "calendar_feeds"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "ai_generations" ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "provider" TEXT;

-- CreateIndex
CREATE INDEX "ai_generations_createdAt_idx" ON "ai_generations"("createdAt");


-- CreateTable
CREATE TABLE "page_goals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_goals_workspaceId_idx" ON "page_goals"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "page_goals_targetId_metric_key" ON "page_goals"("targetId", "metric");

-- AddForeignKey
ALTER TABLE "page_goals" ADD CONSTRAINT "page_goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_goals" ADD CONSTRAINT "page_goals_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "root_activities" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "root_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "root_activities_createdAt_idx" ON "root_activities"("createdAt");

-- AddForeignKey
ALTER TABLE "root_activities" ADD CONSTRAINT "root_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "chart_notes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetId" TEXT,
    "day" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chart_notes_workspaceId_day_idx" ON "chart_notes"("workspaceId", "day");

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "challenge" TEXT,
ADD COLUMN     "pending" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpPendingSecret" TEXT,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_tokenHash_key" ON "trusted_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "trusted_devices_userId_idx" ON "trusted_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credentialId_key" ON "passkeys"("credentialId");

-- CreateIndex
CREATE INDEX "passkeys_userId_idx" ON "passkeys"("userId");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_kind_finishedAt_idx" ON "backup_runs"("kind", "finishedAt");


-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "businessDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "businessEnd" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "businessStart" INTEGER NOT NULL DEFAULT 9;


-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "detail" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_alerts_key_resolvedAt_idx" ON "system_alerts"("key", "resolvedAt");

-- CreateIndex
CREATE INDEX "system_alerts_openedAt_idx" ON "system_alerts"("openedAt");


-- CreateTable
CREATE TABLE "client_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceName" TEXT,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_invitations_tokenHash_key" ON "client_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "client_invitations_email_idx" ON "client_invitations"("email");

-- AddForeignKey
ALTER TABLE "client_invitations" ADD CONSTRAINT "client_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "suspendedAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinnedMetrics" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'sentiment';

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN     "sentiment" TEXT;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "negativeAlertAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "watchNegativeComments" BOOLEAN NOT NULL DEFAULT false;


-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "trendKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "trending_topics" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "traffic" TEXT,
    "newsTitle" TEXT,
    "newsUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trending_topics_country_fetchedAt_idx" ON "trending_topics"("country", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trending_topics_country_title_key" ON "trending_topics"("country", "title");


-- AlterEnum
ALTER TYPE "AiGenerationKind" ADD VALUE 'altText';


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- Everybody already here signed up before verification existed: root, or
-- admitted by an invitation that went to their address.
UPDATE "users" SET "emailVerifiedAt" = "createdAt";

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_tokenHash_key" ON "email_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_tokens_userId_purpose_idx" ON "email_tokens"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Developer features (API keys, MCP, outgoing webhooks) are off unless root
-- turns them on for a workspace.
ALTER TABLE "workspaces" ADD COLUMN "developerFeatures" BOOLEAN NOT NULL DEFAULT false;

-- Workspaces already using them keep them, so no integration stops overnight.
UPDATE "workspaces" SET "developerFeatures" = true
WHERE "id" IN (
  SELECT "workspaceId" FROM "api_tokens" WHERE "revokedAt" IS NULL
  UNION
  SELECT "workspaceId" FROM "webhook_endpoints"
);

-- A read-only member: sees its channels, changes nothing.
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'viewer';

-- The agency's customer as a member: sees calendar and approvals, plus what the workspace opens to clients.
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'client';

ALTER TABLE "workspaces" ADD COLUMN "clientAccess" TEXT[] DEFAULT ARRAY['analytics']::TEXT[];

ALTER TABLE "share_links" ADD COLUMN "decides" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "publishAnywayHours" INTEGER;

CREATE TABLE "plans" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "priceMonthly" INTEGER NOT NULL DEFAULT 0,
  "priceYearly" INTEGER NOT NULL DEFAULT 0,
  "extraChannelPrice" INTEGER NOT NULL DEFAULT 0,
  "channels" INTEGER,
  "members" INTEGER,
  "workspaces" INTEGER,
  "postsPerMonth" INTEGER,
  "aiCredits" INTEGER,
  "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");
ALTER TABLE "users" ADD COLUMN "planId" TEXT, ADD COLUMN "extraChannels" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Suggested values (prices in cents); root edits them in Root › Plans.
INSERT INTO "plans" ("id","key","name","position","priceMonthly","priceYearly","extraChannelPrice","channels","members","workspaces","postsPerMonth","aiCredits","features","isDefault") VALUES
 ('plan_free','free','Free',0,0,0,0,3,1,1,20,20,ARRAY[]::TEXT[],true),
 ('plan_solo','solo','Solo',1,1500,15000,400,5,1,1,NULL,200,ARRAY['api']::TEXT[],false),
 ('plan_team','team','Team',2,3900,39000,300,15,5,3,NULL,600,ARRAY['clients','api']::TEXT[],false),
 ('plan_agency','agency','Agency',3,9900,99000,200,40,NULL,NULL,NULL,2000,ARRAY['clients','whiteLabel','api']::TEXT[],false),
 ('plan_agency_plus','agency_plus','Agency+',4,24900,249000,100,120,NULL,NULL,NULL,6000,ARRAY['clients','whiteLabel','api']::TEXT[],false);

ALTER TYPE "TargetType" ADD VALUE IF NOT EXISTS 'telegram';

ALTER TYPE "TargetType" ADD VALUE IF NOT EXISTS 'youtube';

ALTER TYPE "TargetType" ADD VALUE IF NOT EXISTS 'tiktok';

CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_views_workspaceId_userId_screen_idx" ON "saved_views"("workspaceId", "userId", "screen");

ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_comments" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "conversations" ADD COLUMN "assigneeId" TEXT;

ALTER TABLE "post_targets" ADD COLUMN "messageOverride" TEXT;

CREATE TABLE "inbox_notes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_notes_workspaceId_kind_itemId_idx" ON "inbox_notes"("workspaceId", "kind", "itemId");

ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "bio_pages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bio_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bio_links" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bio_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bio_pages_workspaceId_key" ON "bio_pages"("workspaceId");
CREATE UNIQUE INDEX "bio_pages_slug_key" ON "bio_pages"("slug");
CREATE INDEX "bio_links_pageId_position_idx" ON "bio_links"("pageId", "position");

ALTER TABLE "bio_pages" ADD CONSTRAINT "bio_pages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "bio_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspaces" ADD COLUMN "aiAvoidWords" TEXT;

CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "assigneeId" TEXT,
    "dueOn" TEXT,
    "postId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tasks_workspaceId_status_idx" ON "tasks"("workspaceId", "status");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_targets" ADD COLUMN "skipMedia" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "post_field_values" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "post_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_fields_workspaceId_name_key" ON "custom_fields"("workspaceId", "name");
CREATE UNIQUE INDEX "post_field_values_postId_fieldId_key" ON "post_field_values"("postId", "fieldId");
CREATE INDEX "post_field_values_fieldId_idx" ON "post_field_values"("fieldId");

ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_field_values" ADD CONSTRAINT "post_field_values_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_field_values" ADD CONSTRAINT "post_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspaces" ADD COLUMN "clientApprovalAfterTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "posts" ADD COLUMN "teamApprovedById" TEXT;
ALTER TABLE "posts" ADD COLUMN "teamApprovedAt" TIMESTAMP(3);

ALTER TYPE "AiGenerationKind" ADD VALUE IF NOT EXISTS 'image';

CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agents_workspaceId_idx" ON "ai_agents"("workspaceId");

ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "posts" ADD COLUMN "place" TEXT;

ALTER TABLE "posts" ADD COLUMN "textBackground" TEXT;

ALTER TYPE "AiGenerationKind" ADD VALUE IF NOT EXISTS 'video';

CREATE TABLE "ai_videos" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "mediaId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_videos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_videos_workspaceId_createdAt_idx" ON "ai_videos"("workspaceId", "createdAt");
CREATE INDEX "ai_videos_status_idx" ON "ai_videos"("status");

ALTER TABLE "ai_videos" ADD CONSTRAINT "ai_videos_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AiGenerationKind" ADD VALUE IF NOT EXISTS 'voice';

CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthCode_codeHash_key" ON "OAuthCode"("codeHash");

ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "publishedOn" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "changelog_entries_publishedOn_idx" ON "changelog_entries"("publishedOn");

-- Preserve saved values and metadata; an existing canonical key always wins.
UPDATE app_settings AS source
SET key = 'root.admin.' || substr(source.key, length('root.legacy.') + 1)
WHERE source.key LIKE 'root.legacy.%'
  AND NOT EXISTS (
    SELECT 1 FROM app_settings AS target
    WHERE target.key = 'root.admin.' || substr(source.key, length('root.legacy.') + 1)
  );

-- Persist both halves of workspace data deletion so a crash after database
-- commit can resume filesystem cleanup without reopening the deleted rows.
CREATE TABLE "workspace_data_purges" (
  "workspaceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "requestedById" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "mediaRoot" TEXT NOT NULL,
  "counts" JSONB,
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dbDeletedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_data_purges_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "workspace_data_purges_status_check" CHECK ("status" IN ('requested', 'db_deleted', 'completed'))
);

CREATE INDEX "workspace_data_purges_status_updatedAt_idx" ON "workspace_data_purges"("status", "updatedAt");
ALTER TABLE "workspace_data_purges" ADD CONSTRAINT "workspace_data_purges_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every directly workspace-owned legacy table gets the same write gate. Locking
-- the parent first orders a concurrent write against the purge's FOR UPDATE
-- lock; checking only the job row in a BEFORE trigger would leave a race.
CREATE FUNCTION rebuild_reject_purging_workspace_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM workspace_data_purges
    WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT DISTINCT child.relname AS table_name
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r'
      AND child.relname NOT IN ('memberships', 'workspace_data_purges')
  LOOP
    EXECUTE format('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write()', item.table_name);
  END LOOP;
END $$;

-- Object identity is independent of delivery. Account deletion erases its inventory.
CREATE TABLE ads_objects (
  "adAccountId" TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('campaign', 'adset', 'ad')),
  "objectId" TEXT NOT NULL,
  name TEXT,
  "parentId" TEXT,
  status TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("adAccountId", level, "objectId")
);

CREATE TABLE "mcp_api_keys" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "readFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "writeFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_api_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mcp_api_keys_tokenHash_key" ON "mcp_api_keys"("tokenHash");
CREATE INDEX "mcp_api_keys_workspaceId_createdAt_idx" ON "mcp_api_keys"("workspaceId", "createdAt");
CREATE INDEX "mcp_api_keys_expiresAt_idx" ON "mcp_api_keys"("expiresAt");

-- Distributed lease and append-only outcome history for the replacement worker.
CREATE TABLE "rebuild_job_leases" (
  "name" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_job_leases_pkey" PRIMARY KEY ("name")
);
CREATE INDEX "rebuild_job_leases_leaseExpiresAt_idx" ON "rebuild_job_leases"("leaseExpiresAt");

CREATE TABLE "rebuild_sync_runs" (
  "id" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "outcome" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT,
  "error" TEXT,
  CONSTRAINT "rebuild_sync_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rebuild_sync_runs_job_startedAt_idx" ON "rebuild_sync_runs"("job", "startedAt");
CREATE INDEX "rebuild_sync_runs_finishedAt_idx" ON "rebuild_sync_runs"("finishedAt");

-- Durable, content-free recovery journal for Inbox remote deletions.
CREATE TABLE "rebuild_inbox_deletions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "localItemId" TEXT NOT NULL,
  "localAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suppressedRemoteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "actorId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remoteConfirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "rebuild_inbox_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_inbox_deletions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_inbox_deletions_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'remote_confirmed', 'completed', 'rejected')),
  CONSTRAINT "rebuild_inbox_deletions_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('transport_unconfirmed', 'provider_rejected', 'local_pending')),
  CONSTRAINT "rebuild_inbox_deletions_timestamps_check"
    CHECK (
      ("state" <> 'completed' OR ("remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NOT NULL))
      AND ("state" <> 'remote_confirmed' OR "remoteConfirmedAt" IS NOT NULL)
      AND ("state" IN ('completed', 'remote_confirmed') OR "completedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "rebuild_inbox_deletions_workspaceId_provider_targetId_remoteId_key"
  ON "rebuild_inbox_deletions"("workspaceId", "provider", "targetId", "remoteId");
CREATE INDEX "rebuild_inbox_deletions_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_inbox_deletions"("workspaceId", "targetId", "updatedAt");

-- Durable, content-free recovery journal and tombstones for remote post deletion.
CREATE TABLE "rebuild_post_deletions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "localPostIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "localPostTargetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remoteConfirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "rebuild_post_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_post_deletions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_post_deletions_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'remote_confirmed', 'completed', 'rejected')),
  CONSTRAINT "rebuild_post_deletions_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('transport_unconfirmed', 'provider_rejected', 'external_not_deleted', 'local_pending')),
  CONSTRAINT "rebuild_post_deletions_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'transport_unconfirmed' AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
      OR ("state" = 'remote_confirmed' AND "reason" = 'local_pending' AND "remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NULL)
      OR ("state" = 'completed' AND "reason" IS NULL AND "remoteConfirmedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
      OR ("state" = 'rejected' AND "reason" IN ('provider_rejected', 'external_not_deleted') AND "remoteConfirmedAt" IS NULL AND "completedAt" IS NULL)
    ) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_post_deletions_active_remote_identity_key"
  ON "rebuild_post_deletions"("workspaceId", "provider", "targetId", "remoteId")
  WHERE "state" <> 'rejected';
CREATE INDEX "rebuild_post_deletions_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_post_deletions"("workspaceId", "targetId", "updatedAt");
CREATE INDEX "rebuild_post_deletions_localPostIds_gin_idx"
  ON "rebuild_post_deletions" USING GIN ("localPostIds");

-- Durable, content-free publication intent, receipt, and resolution journal.
-- Identifier bounds are fixed integrity caps (2048 characters) independent of runtime configuration.
CREATE TABLE "rebuild_publication_attempts" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "remotePostId" TEXT,
  "remoteUrl" TEXT,
  "receiptAt" TIMESTAMP(3),
  "projectedAt" TIMESTAMP(3),
  "attestedAt" TIMESTAMP(3),
  "attestedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_publication_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_publication_attempts_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_publication_attempts_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'receipt_recorded', 'projected', 'rejected', 'attested_absent')),
  CONSTRAINT "rebuild_publication_attempts_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('provider_rejected', 'outcome_unknown', 'provider_receipt', 'external_human_attestation')),
  CONSTRAINT "rebuild_publication_attempts_bounds_check"
    CHECK ((
      length("id") BETWEEN 1 AND 2048 AND
      length("workspaceId") BETWEEN 1 AND 2048 AND
      length("postId") BETWEEN 1 AND 2048 AND
      length("postTargetId") BETWEEN 1 AND 2048 AND
      length("targetId") BETWEEN 1 AND 2048 AND
      length("provider") BETWEEN 1 AND 2048 AND
      length("actorId") BETWEEN 1 AND 2048 AND
      ("attestedBy" IS NULL OR length("attestedBy") BETWEEN 1 AND 2048) AND
      ("remotePostId" IS NULL OR length("remotePostId") BETWEEN 1 AND 2048) AND
      ("remoteUrl" IS NULL OR length("remoteUrl") BETWEEN 1 AND 2048)
    ) IS TRUE),
  CONSTRAINT "rebuild_publication_attempts_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'outcome_unknown' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'receipt_recorded' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'projected' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NOT NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'rejected' AND "reason" = 'provider_rejected' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'attested_absent' AND "reason" = 'external_human_attestation' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)
    ) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_publication_attempts_active_postTarget_key"
  ON "rebuild_publication_attempts"("workspaceId", "postTargetId")
  WHERE "state" NOT IN ('rejected', 'attested_absent');
CREATE INDEX "rebuild_publication_attempts_workspaceId_targetId_updatedAt_idx"
  ON "rebuild_publication_attempts"("workspaceId", "targetId", "updatedAt");
CREATE INDEX "rebuild_publication_attempts_workspaceId_postId_postTargetId_idx"
  ON "rebuild_publication_attempts"("workspaceId", "postId", "postTargetId");

-- Content-free intent and receipt journal for Facebook's unpublished photo uploads.
-- Provider objects remain recoverable across a process crash without retaining media bytes or URLs.
CREATE TABLE "rebuild_facebook_media_steps" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "remoteId" TEXT,
  "receiptAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_media_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_facebook_media_steps_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_media_steps_phase_ordinal_check"
    CHECK ((("phase" = 'photo' AND "ordinal" BETWEEN 1 AND 20) OR ("phase" = 'feed' AND "ordinal" = 0)) IS TRUE),
  CONSTRAINT "rebuild_facebook_media_steps_state_check"
    CHECK ("state" IN ('started', 'recorded', 'rejected', 'uncertain')),
  CONSTRAINT "rebuild_facebook_media_steps_bounds_check"
    CHECK (
      length("id") BETWEEN 1 AND 2048 AND
      length("workspaceId") BETWEEN 1 AND 2048 AND
      length("operationId") BETWEEN 1 AND 2048 AND
      length("postId") BETWEEN 1 AND 2048 AND
      length("postTargetId") BETWEEN 1 AND 2048 AND
      length("targetId") BETWEEN 1 AND 2048 AND
      length("actorId") BETWEEN 1 AND 2048 AND
      length("remoteTargetId") BETWEEN 1 AND 2048 AND
      ("remoteId" IS NULL OR length("remoteId") BETWEEN 1 AND 2048)
    ),
  CONSTRAINT "rebuild_facebook_media_steps_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL) OR
      ("state" = 'recorded' AND "remoteId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "rejectedAt" IS NULL) OR
      ("state" = 'rejected' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NOT NULL) OR
      ("state" = 'uncertain' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL)
    ) IS TRUE),
  CONSTRAINT "rebuild_facebook_media_steps_time_order_check"
    CHECK (("createdAt" <= "updatedAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("rejectedAt" IS NULL OR "rejectedAt" <= "updatedAt")) IS TRUE)
);

CREATE UNIQUE INDEX "rebuild_facebook_media_steps_operation_phase_ordinal_key"
  ON "rebuild_facebook_media_steps"("operationId", "phase", "ordinal");
CREATE INDEX "rebuild_facebook_media_steps_workspace_operation_idx"
  ON "rebuild_facebook_media_steps"("workspaceId", "operationId", "phase", "ordinal");
CREATE INDEX "rebuild_facebook_media_steps_workspace_target_updated_idx"
  ON "rebuild_facebook_media_steps"("workspaceId", "targetId", "updatedAt");
CREATE UNIQUE INDEX "rebuild_facebook_media_steps_known_remote_id_key"
  ON "rebuild_facebook_media_steps"("workspaceId", "targetId", "phase", "remoteId")
  WHERE "remoteId" IS NOT NULL;

CREATE TABLE rebuild_facebook_media_deletions (
  id text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "mediaStepId" text NOT NULL,
  "operationId" text NOT NULL,
  "postId" text NOT NULL,
  "postTargetId" text NOT NULL,
  "targetId" text NOT NULL,
  "remoteTargetId" text NOT NULL,
  "remotePhotoId" text NOT NULL,
  "actorId" text NOT NULL,
  state text NOT NULL DEFAULT 'started',
  "receiptAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rebuild_facebook_media_deletions_workspace_fk
    FOREIGN KEY ("workspaceId") REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT rebuild_facebook_media_deletions_id_length_check
    CHECK (char_length(id) BETWEEN 1 AND 2048),
  CONSTRAINT rebuild_facebook_media_deletions_binding_length_check
    CHECK (
      char_length("workspaceId") BETWEEN 1 AND 2048 AND
      char_length("mediaStepId") BETWEEN 1 AND 2048 AND
      char_length("operationId") BETWEEN 1 AND 2048 AND
      char_length("postId") BETWEEN 1 AND 2048 AND
      char_length("postTargetId") BETWEEN 1 AND 2048 AND
      char_length("targetId") BETWEEN 1 AND 2048 AND
      char_length("remoteTargetId") BETWEEN 1 AND 2048 AND
      char_length("remotePhotoId") BETWEEN 1 AND 2048 AND
      char_length("actorId") BETWEEN 1 AND 2048
    ),
  CONSTRAINT rebuild_facebook_media_deletions_no_control_chars_check
    CHECK (
      id !~ '[[:cntrl:]]' AND "workspaceId" !~ '[[:cntrl:]]' AND
      "mediaStepId" !~ '[[:cntrl:]]' AND "operationId" !~ '[[:cntrl:]]' AND
      "postId" !~ '[[:cntrl:]]' AND "postTargetId" !~ '[[:cntrl:]]' AND
      "targetId" !~ '[[:cntrl:]]' AND "remoteTargetId" !~ '[[:cntrl:]]' AND
      "remotePhotoId" !~ '[[:cntrl:]]' AND "actorId" !~ '[[:cntrl:]]'
    ),
  CONSTRAINT rebuild_facebook_media_deletions_state_check
    CHECK ((state IN ('started', 'uncertain', 'confirmed', 'rejected')) IS TRUE),
  CONSTRAINT rebuild_facebook_media_deletions_receipt_check
    CHECK ((
      (state IN ('started', 'uncertain') AND "receiptAt" IS NULL) OR
      (state IN ('confirmed', 'rejected') AND "receiptAt" IS NOT NULL)
    ) IS TRUE),
  CONSTRAINT rebuild_facebook_media_deletions_updated_check
    CHECK (("updatedAt" >= "createdAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt")) IS TRUE)
);

-- Rejected requests can be explicitly tried again. Started, uncertain and confirmed rows
-- reserve the exact known photo identity, preventing concurrent or duplicate cleanup.
CREATE UNIQUE INDEX rebuild_facebook_media_deletions_active_photo_unique
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId")
  WHERE state <> 'rejected';

CREATE INDEX rebuild_facebook_media_deletions_workspace_updated_idx
  ON rebuild_facebook_media_deletions ("workspaceId", "updatedAt" DESC, id DESC);

CREATE INDEX rebuild_facebook_media_deletions_step_history_idx
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId", "createdAt" DESC, id DESC);

CREATE FUNCTION rebuild_facebook_media_deletions_binding_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."workspaceId", NEW."mediaStepId", NEW."operationId", NEW."postId",
         NEW."postTargetId", NEW."targetId", NEW."remoteTargetId", NEW."remotePhotoId", NEW."actorId", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD.id, OLD."workspaceId", OLD."mediaStepId", OLD."operationId", OLD."postId",
         OLD."postTargetId", OLD."targetId", OLD."remoteTargetId", OLD."remotePhotoId", OLD."actorId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Facebook media deletion binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rebuild_facebook_media_deletions_binding_immutable_trigger
  BEFORE UPDATE ON rebuild_facebook_media_deletions
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_media_deletions_binding_immutable();

-- Immutable operator attestations and delayed provider-result evidence for
-- Facebook's content-free multi-photo and staged-photo deletion journals.
ALTER TABLE rebuild_facebook_media_steps
  ADD COLUMN "attestedAt" TIMESTAMP(3),
  ADD COLUMN "attestedBy" TEXT;

ALTER TABLE rebuild_facebook_media_steps
  DROP CONSTRAINT rebuild_facebook_media_steps_state_check,
  DROP CONSTRAINT rebuild_facebook_media_steps_state_timestamps_check,
  DROP CONSTRAINT rebuild_facebook_media_steps_time_order_check,
  ADD CONSTRAINT rebuild_facebook_media_steps_state_check
    CHECK ("state" IN ('started', 'recorded', 'rejected', 'uncertain', 'attested_present', 'attested_absent', 'conflict')),
  ADD CONSTRAINT rebuild_facebook_media_steps_state_timestamps_check
    CHECK ((
      ("state" = 'started' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'recorded' AND "remoteId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'rejected' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NOT NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'uncertain' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      ("state" = 'attested_present' AND "remoteId" IS NOT NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      ("state" = 'attested_absent' AND "remoteId" IS NULL AND "receiptAt" IS NULL AND "rejectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      ("state" = 'conflict' AND ("remoteId" IS NULL OR "receiptAt" IS NOT NULL) AND "rejectedAt" IS NULL AND (("attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
    ) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_steps_time_order_check
    CHECK (("createdAt" <= "updatedAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("rejectedAt" IS NULL OR "rejectedAt" <= "updatedAt") AND ("attestedAt" IS NULL OR "attestedAt" <= "updatedAt")) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_steps_attestor_bound_check
    CHECK ("attestedBy" IS NULL OR (length("attestedBy") BETWEEN 1 AND 2048 AND "attestedBy" !~ '[[:cntrl:]]'));

ALTER TABLE rebuild_facebook_media_deletions
  ADD COLUMN "attestedAt" timestamptz,
  ADD COLUMN "attestedBy" text;

ALTER TABLE rebuild_facebook_media_deletions
  DROP CONSTRAINT rebuild_facebook_media_deletions_state_check,
  DROP CONSTRAINT rebuild_facebook_media_deletions_receipt_check,
  DROP CONSTRAINT rebuild_facebook_media_deletions_updated_check,
  ADD CONSTRAINT rebuild_facebook_media_deletions_state_check
    CHECK ((state IN ('started', 'uncertain', 'confirmed', 'rejected', 'attested_deleted', 'attested_present', 'conflict')) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_receipt_check
    CHECK ((
      (state IN ('started', 'uncertain') AND "receiptAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      (state IN ('confirmed', 'rejected') AND "receiptAt" IS NOT NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR
      (state IN ('attested_deleted', 'attested_present') AND "receiptAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL) OR
      (state = 'conflict' AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND (("attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
    ) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_updated_check
    CHECK (("updatedAt" >= "createdAt" AND ("receiptAt" IS NULL OR "receiptAt" <= "updatedAt") AND ("attestedAt" IS NULL OR "attestedAt" <= "updatedAt")) IS TRUE),
  ADD CONSTRAINT rebuild_facebook_media_deletions_attestor_bound_check
    CHECK ("attestedBy" IS NULL OR (char_length("attestedBy") BETWEEN 1 AND 2048 AND "attestedBy" !~ '[[:cntrl:]]'));

DROP INDEX rebuild_facebook_media_deletions_active_photo_unique;
CREATE UNIQUE INDEX rebuild_facebook_media_deletions_active_photo_unique
  ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId")
  WHERE state NOT IN ('rejected', 'attested_present');

CREATE TABLE rebuild_facebook_media_resolutions (
  id text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "operationId" text NOT NULL,
  "mediaStepId" text NOT NULL,
  "deletionId" text,
  "postId" text NOT NULL,
  "postTargetId" text NOT NULL,
  "targetId" text NOT NULL,
  "remoteTargetId" text NOT NULL,
  "publicationActorId" text NOT NULL,
  "eventActorId" text,
  phase text NOT NULL,
  ordinal integer NOT NULL,
  source text NOT NULL,
  outcome text NOT NULL,
  "remoteId" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rebuild_facebook_media_resolutions_workspace_fk
    FOREIGN KEY ("workspaceId") REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT rebuild_facebook_media_resolutions_phase_check
    CHECK (((phase = 'photo' AND ordinal BETWEEN 1 AND 20 AND "deletionId" IS NULL) OR
            (phase = 'feed' AND ordinal = 0 AND "deletionId" IS NULL) OR
            (phase = 'delete' AND ordinal BETWEEN 1 AND 20 AND "deletionId" IS NOT NULL)) IS TRUE),
  CONSTRAINT rebuild_facebook_media_resolutions_source_check
    CHECK (source IN ('operator', 'provider')),
  CONSTRAINT rebuild_facebook_media_resolutions_outcome_check
    CHECK (outcome IN ('photo_present', 'photo_absent', 'feed_present', 'feed_absent', 'delete_deleted', 'delete_present', 'late_provider_receipt', 'late_provider_rejection', 'late_provider_uncertain')),
  CONSTRAINT rebuild_facebook_media_resolutions_binding_length_check
    CHECK (
      char_length(id) BETWEEN 1 AND 2048 AND
      char_length("workspaceId") BETWEEN 1 AND 2048 AND
      char_length("operationId") BETWEEN 1 AND 2048 AND
      char_length("mediaStepId") BETWEEN 1 AND 2048 AND
      ("deletionId" IS NULL OR char_length("deletionId") BETWEEN 1 AND 2048) AND
      char_length("postId") BETWEEN 1 AND 2048 AND
      char_length("postTargetId") BETWEEN 1 AND 2048 AND
      char_length("targetId") BETWEEN 1 AND 2048 AND
      char_length("remoteTargetId") BETWEEN 1 AND 2048 AND
      char_length("publicationActorId") BETWEEN 1 AND 2048 AND
      ("eventActorId" IS NULL OR char_length("eventActorId") BETWEEN 1 AND 2048) AND
      ("remoteId" IS NULL OR char_length("remoteId") BETWEEN 1 AND 2048)
    ),
  CONSTRAINT rebuild_facebook_media_resolutions_control_chars_check
    CHECK (
      id !~ '[[:cntrl:]]' AND "workspaceId" !~ '[[:cntrl:]]' AND "operationId" !~ '[[:cntrl:]]' AND
      "mediaStepId" !~ '[[:cntrl:]]' AND ("deletionId" IS NULL OR "deletionId" !~ '[[:cntrl:]]') AND
      "postId" !~ '[[:cntrl:]]' AND "postTargetId" !~ '[[:cntrl:]]' AND "targetId" !~ '[[:cntrl:]]' AND
      "remoteTargetId" !~ '[[:cntrl:]]' AND "publicationActorId" !~ '[[:cntrl:]]' AND
      ("eventActorId" IS NULL OR "eventActorId" !~ '[[:cntrl:]]') AND ("remoteId" IS NULL OR "remoteId" !~ '[[:cntrl:]]')
    ),
  CONSTRAINT rebuild_facebook_media_resolutions_actor_check
    CHECK (((source = 'operator' AND "eventActorId" IS NOT NULL AND outcome IN ('photo_present', 'photo_absent', 'feed_present', 'feed_absent', 'delete_deleted', 'delete_present')) OR
            (source = 'provider' AND "eventActorId" IS NULL AND outcome IN ('late_provider_receipt', 'late_provider_rejection', 'late_provider_uncertain'))) IS TRUE),
  CONSTRAINT rebuild_facebook_media_resolutions_remote_id_check
    CHECK (((outcome IN ('photo_present', 'feed_present', 'late_provider_receipt') AND "remoteId" IS NOT NULL) OR
            (outcome NOT IN ('photo_present', 'feed_present', 'late_provider_receipt') AND "remoteId" IS NULL)) IS TRUE)
);

CREATE INDEX rebuild_facebook_media_resolutions_operation_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "operationId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_facebook_media_resolutions_step_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "mediaStepId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_facebook_media_resolutions_deletion_history_idx
  ON rebuild_facebook_media_resolutions ("workspaceId", "deletionId", "createdAt" DESC, id DESC)
  WHERE "deletionId" IS NOT NULL;

CREATE FUNCTION rebuild_facebook_media_resolutions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Facebook media resolution history is immutable';
END;
$$;

CREATE TRIGGER rebuild_facebook_media_resolutions_immutable_trigger
  -- Workspace erasure owns deletion of scoped rows; normal module code has no delete path.
  BEFORE UPDATE ON rebuild_facebook_media_resolutions
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_media_resolutions_immutable();

CREATE TABLE rebuild_notifications (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 2048),
  "eventId" TEXT NOT NULL CHECK (length("eventId") BETWEEN 1 AND 2048),
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note_mention', 'mix_dry')),
  "postId" TEXT REFERENCES posts(id) ON DELETE CASCADE,
  "noteId" TEXT REFERENCES post_notes(id) ON DELETE CASCADE,
  "targetId" TEXT REFERENCES targets(id) ON DELETE CASCADE,
  "labelId" TEXT REFERENCES labels(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "readAt" TIMESTAMPTZ,
  "emailSentAt" TIMESTAMPTZ,
  "lastAttemptAt" TIMESTAMPTZ,
  "emailState" TEXT NOT NULL DEFAULT 'pending' CHECK ("emailState" IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  "nextAt" TIMESTAMPTZ,
  "claimToken" TEXT,
  "claimUntil" TIMESTAMPTZ,
  "safeReason" TEXT CHECK ("safeReason" IS NULL OR "safeReason" IN ('recipient_unavailable', 'preflight_unavailable', 'mail_unavailable', 'mail_failed', 'mail_uncertain', 'claim_expired', 'authorization_changed', 'resource_unavailable')),
  CONSTRAINT rebuild_notifications_claim_shape CHECK (("emailState" = 'sending') = ("claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL)),
  CONSTRAINT rebuild_notifications_sent_shape CHECK (("emailState" = 'sent') = ("emailSentAt" IS NOT NULL)),
  CONSTRAINT rebuild_notifications_attempt_shape CHECK ((attempt = 0) = ("lastAttemptAt" IS NULL)),
  CONSTRAINT rebuild_notifications_context_shape CHECK (
    (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
    OR (kind = 'mix_dry' AND "targetId" IS NOT NULL)
  ),
  CONSTRAINT rebuild_notifications_id_workspace_cap CHECK (
    length("eventId") <= 2048 AND length("workspaceId") <= 2048 AND length("userId") <= 2048
  )
);

CREATE UNIQUE INDEX rebuild_notifications_event_recipient_uq
  ON rebuild_notifications ("workspaceId", "eventId", "userId");
CREATE INDEX rebuild_notifications_recipient_page_idx
  ON rebuild_notifications ("workspaceId", "userId", "createdAt" DESC, id DESC);
CREATE INDEX rebuild_notifications_delivery_due_idx
  ON rebuild_notifications ("nextAt", "createdAt", id)
  WHERE "emailState" = 'pending';
CREATE INDEX rebuild_notifications_delivery_lease_idx
  ON rebuild_notifications ("claimUntil", id)
  WHERE "emailState" = 'sending';

CREATE TABLE ads_management_operations (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "adAccountId" TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL CHECK (length("requestId") BETWEEN 8 AND 128),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "operationType" TEXT NOT NULL CHECK ("operationType" IN ('status.set','budget.set','rename','creative.assign','delete')),
  "objectType" TEXT NOT NULL CHECK ("objectType" IN ('campaign','adset','ad')),
  "objectId" TEXT NOT NULL,
  params JSONB NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','rejected','uncertain','resolved_applied','resolved_not_applied')),
  "remoteId" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMPTZ,
  "resolutionNote" TEXT,
  CONSTRAINT ads_operations_resolution_shape CHECK (
    (status IN ('resolved_applied','resolved_not_applied')) = ("resolvedBy" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX ads_management_operations_actor_request
  ON ads_management_operations ("workspaceId", "actorId", "requestId");
CREATE UNIQUE INDEX ads_management_operations_open_object
  ON ads_management_operations ("workspaceId", "adAccountId", "objectType", "objectId")
  WHERE status IN ('pending','uncertain');
CREATE INDEX ads_management_operations_history
  ON ads_management_operations ("workspaceId", "adAccountId", "createdAt" DESC, id);

-- Extend the same durable journal; do not create a separate creation write path.
ALTER TABLE ads_management_operations
  DROP CONSTRAINT "ads_management_operations_operationType_check";
ALTER TABLE ads_management_operations
  ADD CONSTRAINT ads_operations_operation_kind CHECK (
    "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create')
  );

-- Reconcile the database erasure guard for schema-built legacy installations.
-- The existing purge table and all customer rows are preserved. This prerequisite
-- must run before new workspace-owned module tables install the shared gate.
DO $$
BEGIN
  IF to_regclass('public.workspace_data_purges') IS NULL THEN
    RAISE EXCEPTION 'workspace_data_purges prerequisite table is missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rebuild_reject_purging_workspace_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Erasure takes FOR UPDATE on this same parent. A concurrent child write
  -- must finish before erasure, or wait and observe the recorded purge state.
  PERFORM 1 FROM public.workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
    WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE item record; installed record;
BEGIN
  FOR item IN
    SELECT DISTINCT child.oid, child.relname AS table_name
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r'
      AND child.relname NOT IN ('memberships', 'workspace_data_purges')
  LOOP
    SELECT tgfoid, tgenabled INTO installed FROM pg_trigger
      WHERE tgrelid = item.oid AND tgname = 'rebuild_workspace_purge_write_gate'
        AND NOT tgisinternal;
    IF FOUND THEN
      IF installed.tgfoid <> 'public.rebuild_reject_purging_workspace_write()'::regprocedure
         OR installed.tgenabled NOT IN ('O', 'A') THEN
        RAISE EXCEPTION 'Unexpected or disabled workspace purge gate on %', item.table_name;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write()', item.table_name);
    END IF;
  END LOOP;
END $$;

-- Task comments for the rebuild Tasks module. Additive: one new table and one
-- unique index on the existing tasks table. Existing rows are not rewritten.
--
-- Workspace boundary: a comment's (taskId, workspaceId) must name an existing
-- task of that same workspace. The composite foreign key makes a cross-workspace
-- comment unrepresentable, whatever code path writes it.
-- Lifecycle:
--   * deleting a task or its workspace deletes the comments (ON DELETE CASCADE),
--     so workspace erasure and exports need no table-specific handling;
--   * deleting a user keeps the comment but clears the author (ON DELETE SET NULL),
--     which the app shows as "Former member".

-- Target of the composite foreign key. "id" is already the primary key, so this
-- cannot fail on existing data; it only adds the (id, workspaceId) lookup.
CREATE UNIQUE INDEX "tasks_id_workspaceId_key" ON "tasks"("id", "workspaceId");

CREATE TABLE "task_comments" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id"),
  -- Ceiling matches the largest value Root may configure for tasks.commentMaxCharacters.
  CONSTRAINT "task_comments_body_check" CHECK (char_length(btrim("body")) > 0 AND char_length("body") <= 20000)
);

-- Ordered comment history of one task, and the author lookup used by SET NULL.
CREATE INDEX "task_comments_taskId_createdAt_id_idx" ON "task_comments"("taskId", "createdAt", "id");
CREATE INDEX "task_comments_workspaceId_idx" ON "task_comments"("workspaceId");
CREATE INDEX "task_comments_authorId_idx" ON "task_comments"("authorId");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fkey"
  FOREIGN KEY ("taskId", "workspaceId") REFERENCES "tasks"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The earlier workspace_data_purges migration installed this write gate on every
-- workspace-owned table that existed then. New tables must join it, otherwise a
-- comment could be written while the workspace is being erased.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

-- Legacy links without an expiry remain stored but are not publicly served by the rebuild.
-- Owners can rotate/recreate them with an explicit bounded lifetime.
ALTER TABLE "share_links" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- NULL preserves pre-scope credential behavior; new credentials use a validated versioned ceiling.
ALTER TABLE "mcp_api_keys" ADD COLUMN "resourceScope" JSONB;
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_resource_scope_shape" CHECK (
  "resourceScope" IS NULL OR (
    jsonb_typeof("resourceScope") = 'object'
    AND "resourceScope" ?& ARRAY['version', 'mode']
    AND "resourceScope"->'version' = '1'::jsonb
    AND (("resourceScope"->>'mode' = 'all' AND NOT ("resourceScope" ? 'ids'))
      OR ("resourceScope"->>'mode' = 'selected' AND "resourceScope" ? 'ids' AND jsonb_typeof("resourceScope"->'ids') = 'array'))
  )
);

-- Additive report evidence and bounded manual download receipts. Existing
-- report_templates/report_schedules, recipients and aiRecap are preserved.
CREATE TABLE report_runs (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "scheduleId" TEXT REFERENCES report_schedules(id) ON DELETE SET NULL,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manual','scheduled')),
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "claimToken" TEXT NOT NULL,
  "requestHash" CHAR(64) CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$'),
  "periodStart" TEXT NOT NULL CHECK ("periodStart" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char("periodStart"::date,'YYYY-MM-DD') = "periodStart"),
  "periodEnd" TEXT NOT NULL CHECK ("periodEnd" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char("periodEnd"::date,'YYYY-MM-DD') = "periodEnd"),
  status TEXT NOT NULL CHECK (status IN ('claimed','generating','delivering','completed','partial','failed','uncertain','skipped')),
  "leaseUntil" TIMESTAMPTZ NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finishedAt" TIMESTAMPTZ,
  "rowCount" INTEGER CHECK ("rowCount" IS NULL OR "rowCount" >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  "failureReason" TEXT,
  deliveries JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliveries) = 'array'),
  "requestedById" TEXT,
  output JSONB CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  "outputExpiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("periodStart" <= "periodEnd"),
  CHECK (kind <> 'manual' OR "requestHash" IS NOT NULL),
  CHECK ((output IS NULL) = ("outputExpiresAt" IS NULL)),
  CHECK (output IS NULL OR (kind = 'manual' AND status = 'completed')),
  CHECK ((status IN ('claimed','generating','delivering')) = ("finishedAt" IS NULL))
);
CREATE INDEX report_runs_workspace_history ON report_runs ("workspaceId", "startedAt" DESC, id);
CREATE INDEX report_runs_channel_history ON report_runs ("workspaceId", "targetId", "startedAt" DESC, id);
CREATE INDEX report_runs_open_leases ON report_runs ("leaseUntil", id) WHERE status IN ('claimed','generating','delivering');
CREATE INDEX report_runs_output_expiry ON report_runs ("outputExpiresAt", id) WHERE output IS NOT NULL;

-- The earlier reviewed purge gate predates report_runs. Join the same lock and
-- erasure guard without rewriting the already-applied report history migration.
DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON report_runs
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

-- Additive neutral per-destination intent. NULL retains an existing legacy
-- destination's post-level format; newly authored destinations store an ID.
ALTER TABLE post_targets ADD COLUMN "formatId" text;
ALTER TABLE post_targets ADD CONSTRAINT rebuild_destination_format_identity
  CHECK ("formatId" IS NULL OR (char_length("formatId") BETWEEN 1 AND 128 AND "formatId" = btrim("formatId")));
-- Versions retain the exact target -> format map that was reviewed or edited.
ALTER TABLE post_versions ADD COLUMN "destinationFormats" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE post_versions ADD CONSTRAINT rebuild_version_destination_formats_object
  CHECK (jsonb_typeof("destinationFormats") = 'object');

-- Facebook native publishing receipts are a child of the neutral publication
-- claim. This journal stores bounded, content-free protocol evidence only.
CREATE UNIQUE INDEX "rebuild_publication_attempts_workspaceId_id_key"
  ON "rebuild_publication_attempts"("workspaceId", "id");

CREATE TABLE "rebuild_facebook_native_journal" (
  "operationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "postTargetId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "sourceFormatId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "ownerToken" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'started',
  "knownIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "remoteId" TEXT,
  "conflicted" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_journal_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "rebuild_facebook_native_journal_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_journal_parent_fkey"
    FOREIGN KEY ("workspaceId", "operationId") REFERENCES "rebuild_publication_attempts"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_journal_binding_check" CHECK ((
    length("operationId") BETWEEN 1 AND 2048 AND
    length("workspaceId") BETWEEN 1 AND 2048 AND
    length("postId") BETWEEN 1 AND 2048 AND
    length("postTargetId") BETWEEN 1 AND 2048 AND
    length("targetId") BETWEEN 1 AND 2048 AND
    length("actorId") BETWEEN 1 AND 2048 AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND
    "operationId" = btrim("operationId") AND "operationId" !~ '[[:cntrl:]]' AND
    "workspaceId" = btrim("workspaceId") AND "workspaceId" !~ '[[:cntrl:]]' AND
    "postId" = btrim("postId") AND "postId" !~ '[[:cntrl:]]' AND
    "postTargetId" = btrim("postTargetId") AND "postTargetId" !~ '[[:cntrl:]]' AND
    "targetId" = btrim("targetId") AND "targetId" !~ '[[:cntrl:]]' AND
    "actorId" = btrim("actorId") AND "actorId" !~ '[[:cntrl:]]' AND
    "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    length("sourceFormatId") BETWEEN 1 AND 128 AND "sourceFormatId" = btrim("sourceFormatId") AND
    "sourceFormatId" !~ '[[:cntrl:]]' AND
    "format" IN ('video', 'reel', 'story_photo', 'story_video') AND
    "payloadHash" ~ '^[0-9a-f]{64}$' AND "revision" >= 0 AND
    ("remoteId" IS NULL OR (length("remoteId") BETWEEN 1 AND 2048 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]')) AND
    "createdAt" <= "updatedAt"
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_journal_state_check"
    CHECK ("state" IN ('started', 'published', 'rejected', 'uncertain', 'confirmed', 'deleted')),
  CONSTRAINT "rebuild_facebook_native_journal_json_check" CHECK ((
    jsonb_typeof("knownIds") = 'array' AND jsonb_typeof("steps") = 'array' AND
    ("state" <> 'started' OR "remoteId" IS NULL) AND
    ("remoteId" IS NULL OR "knownIds" @> jsonb_build_array("remoteId")) AND
    ("state" NOT IN ('published', 'confirmed', 'deleted') OR "remoteId" IS NOT NULL)
  ) IS TRUE)
);

CREATE INDEX "rebuild_facebook_native_journal_workspace_target_updated_idx"
  ON "rebuild_facebook_native_journal"("workspaceId", "targetId", "updatedAt");

CREATE FUNCTION "rebuild_facebook_native_journal_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "rebuild_publication_attempts"%ROWTYPE;
  expected text[];
  step jsonb;
  i integer;
  id_value text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0 OR NEW."state" <> 'started' OR NEW."remoteId" IS NOT NULL OR
       NEW."knownIds" <> '[]'::jsonb OR NEW."steps" <> '[]'::jsonb OR NEW."conflicted" THEN
      RAISE EXCEPTION 'native journal must begin empty and started';
    END IF;
    SELECT * INTO parent_row FROM "rebuild_publication_attempts"
      WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
    IF NOT FOUND OR parent_row."provider" <> 'facebook' OR parent_row."state" <> 'started' OR
       parent_row."postId" <> NEW."postId" OR parent_row."postTargetId" <> NEW."postTargetId" OR
       parent_row."targetId" <> NEW."targetId" OR parent_row."actorId" <> NEW."actorId" THEN
      RAISE EXCEPTION 'native journal binding does not match a live Facebook publication claim';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "posts" p
      JOIN "post_targets" pt ON pt."id" = NEW."postTargetId" AND pt."postId" = p."id" AND pt."targetId" = NEW."targetId"
      JOIN "targets" t ON t."id" = pt."targetId" AND t."workspaceId" = NEW."workspaceId"
      JOIN "social_accounts" sa ON sa."id" = t."socialAccountId" AND sa."workspaceId" = NEW."workspaceId"
      WHERE p."id" = NEW."postId" AND p."workspaceId" = NEW."workspaceId"
        AND pt."status" = 'processing'
        AND pt."remotePostId" IS NULL AND t."providerId" = NEW."remoteTargetId"
        AND t."type" = 'page' AND t."enabled" AND sa."provider" = 'facebook' AND sa."invalidatedAt" IS NULL
        AND COALESCE(pt."formatId", p."format") = NEW."sourceFormatId"
    ) THEN
      RAISE EXCEPTION 'native journal requires matching live Facebook page projections';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW."operationId", NEW."workspaceId", NEW."postId", NEW."postTargetId", NEW."targetId", NEW."actorId", NEW."remoteTargetId", NEW."format", NEW."sourceFormatId", NEW."payloadHash", NEW."ownerToken", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."operationId", OLD."workspaceId", OLD."postId", OLD."postTargetId", OLD."targetId", OLD."actorId", OLD."remoteTargetId", OLD."format", OLD."sourceFormatId", OLD."payloadHash", OLD."ownerToken", OLD."createdAt") THEN
    RAISE EXCEPTION 'native journal binding is immutable';
  END IF;
  SELECT * INTO parent_row FROM "rebuild_publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' OR
     parent_row."postId" IS DISTINCT FROM NEW."postId" OR parent_row."postTargetId" IS DISTINCT FROM NEW."postTargetId" OR
     parent_row."targetId" IS DISTINCT FROM NEW."targetId" OR parent_row."actorId" IS DISTINCT FROM NEW."actorId" THEN
    RAISE EXCEPTION 'native journal update binding does not match its Facebook publication claim';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'native journal revision must advance by one'; END IF;
  IF OLD."conflicted" AND NOT NEW."conflicted" THEN RAISE EXCEPTION 'native journal conflict is irreversible'; END IF;
  IF NOT (
    (OLD."state" = 'started' AND NEW."state" IN ('started', 'published', 'rejected', 'uncertain')) OR
    (OLD."state" = 'uncertain' AND NEW."state" IN ('uncertain', 'confirmed', 'deleted', 'published')) OR
    (OLD."state" = 'published' AND NEW."state" IN ('published', 'uncertain', 'confirmed', 'deleted')) OR
    (OLD."state" = 'confirmed' AND NEW."state" IN ('confirmed', 'uncertain', 'deleted')) OR
    (OLD."state" = 'rejected' AND NEW."state" IN ('rejected', 'uncertain')) OR
    (OLD."state" = 'deleted' AND NEW."state" = 'deleted')
  ) THEN RAISE EXCEPTION 'invalid native journal state transition'; END IF;
  IF OLD."remoteId" IS NOT NULL AND NEW."remoteId" IS DISTINCT FROM OLD."remoteId" THEN
    RAISE EXCEPTION 'native journal remote identity is immutable once recorded';
  END IF;
  IF OLD."state" = 'deleted' AND NEW."steps" IS DISTINCT FROM OLD."steps" THEN
    RAISE EXCEPTION 'deleted native journal protocol steps are immutable';
  END IF;
  -- Late facts after a verified, rejected, or deleted outcome are retained only with an irreversible conflict marker.
  IF OLD."state" IN ('confirmed', 'rejected', 'deleted') AND
     jsonb_array_length(NEW."knownIds") > jsonb_array_length(OLD."knownIds") AND NOT NEW."conflicted" THEN
    RAISE EXCEPTION 'late identifiers after a terminal outcome must mark the journal conflicted';
  END IF;
  IF NEW."updatedAt" < OLD."updatedAt" THEN RAISE EXCEPTION 'native journal timestamp cannot move backwards'; END IF;
  IF NEW."updatedAt" < NEW."createdAt" THEN RAISE EXCEPTION 'native journal update cannot precede creation'; END IF;

  IF NEW."format" = 'video' THEN expected := ARRAY['video_create'];
  ELSIF NEW."format" = 'reel' THEN expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish'];
  ELSIF NEW."format" = 'story_photo' THEN expected := ARRAY['photo_upload', 'story_create'];
  ELSE expected := ARRAY['upload_start', 'upload_transfer', 'story_finish']; END IF;
  IF jsonb_typeof(NEW."steps") <> 'array' OR jsonb_array_length(NEW."steps") > cardinality(expected) THEN
    RAISE EXCEPTION 'native journal steps exceed protocol';
  END IF;
  FOR i IN 0..jsonb_array_length(NEW."steps") - 1 LOOP
    step := NEW."steps" -> i;
    IF jsonb_typeof(step) <> 'object' OR
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(step) AS keys(key)) IS DISTINCT FROM ARRAY['confirmed', 'dispatched', 'phase']::text[] OR
       step->>'phase' IS DISTINCT FROM expected[i + 1] OR jsonb_typeof(step->'dispatched') <> 'boolean' OR
       step->'dispatched' <> 'true'::jsonb OR jsonb_typeof(step->'confirmed') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid native journal protocol step';
    END IF;
    IF i > 0 AND NEW."steps"->(i - 1)->'confirmed' <> 'true'::jsonb THEN
      RAISE EXCEPTION 'each native journal step requires prior confirmation';
    END IF;
    IF i < jsonb_array_length(OLD."steps") AND OLD."steps"->i->'confirmed' = 'true'::jsonb AND NEW."steps"->i->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'native journal confirmations are irreversible';
    END IF;
    IF i < jsonb_array_length(OLD."steps") AND ((NEW."steps"->i) - 'confirmed') IS DISTINCT FROM ((OLD."steps"->i) - 'confirmed') THEN
      RAISE EXCEPTION 'native journal step fields cannot be rewritten';
    END IF;
  END LOOP;
  IF jsonb_array_length(NEW."steps") < jsonb_array_length(OLD."steps") THEN
    RAISE EXCEPTION 'native journal protocol steps are append-only';
  END IF;

  IF jsonb_typeof(NEW."knownIds") <> 'array' OR jsonb_array_length(NEW."knownIds") > 16 OR
     jsonb_array_length(NEW."knownIds") < jsonb_array_length(OLD."knownIds") THEN
    RAISE EXCEPTION 'native journal known identifiers are append-only and capped';
  END IF;
  FOR i IN 0..jsonb_array_length(NEW."knownIds") - 1 LOOP
    id_value := NEW."knownIds"->>i;
    IF jsonb_typeof(NEW."knownIds"->i) <> 'string' OR id_value IS NULL OR
       length(id_value) NOT BETWEEN 1 AND 2048 OR id_value <> btrim(id_value) OR id_value ~ '[[:cntrl:]]' OR
       (i < jsonb_array_length(OLD."knownIds") AND NEW."knownIds"->i IS DISTINCT FROM OLD."knownIds"->i) OR
       EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW."knownIds") WITH ORDINALITY e(v,n) WHERE e.v = id_value AND e.n < i + 1) THEN
      RAISE EXCEPTION 'invalid or repeated native journal identifier';
    END IF;
  END LOOP;

  IF NEW."state" IN ('published', 'confirmed', 'deleted') THEN
    IF jsonb_array_length(NEW."steps") <> cardinality(expected) OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."steps") AS s(v) WHERE s.v->'confirmed' <> 'true'::jsonb) OR
       NEW."remoteId" IS NULL OR NOT (NEW."knownIds" @> jsonb_build_array(NEW."remoteId")) THEN
      RAISE EXCEPTION 'completed native journal requires fully confirmed protocol and known remote id';
    END IF;
  END IF;
  IF NEW."state" = 'started' AND NEW."remoteId" IS NOT NULL THEN RAISE EXCEPTION 'started native journal cannot have remote id'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_journal_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_journal"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_journal_guard"();

CREATE FUNCTION "rebuild_publication_attempts_native_binding_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."provider", NEW."workspaceId", NEW."postId", NEW."postTargetId", NEW."targetId", NEW."actorId")
     IS DISTINCT FROM
     (OLD."id", OLD."provider", OLD."workspaceId", OLD."postId", OLD."postTargetId", OLD."targetId", OLD."actorId") AND
     EXISTS (SELECT 1 FROM "rebuild_facebook_native_journal" j WHERE j."operationId" = OLD."id" AND j."workspaceId" = OLD."workspaceId") THEN
    RAISE EXCEPTION 'publication claim binding cannot change after native journal creation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_publication_attempts_native_binding_guard_trigger"
  BEFORE UPDATE ON "rebuild_publication_attempts"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_publication_attempts_native_binding_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_journal"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- Provider-owned observations of native publication status. This ledger is a
-- child of the existing publication claim and grants no dispatch authority.
CREATE TABLE "rebuild_facebook_native_status_proofs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "observedRevision" INTEGER NOT NULL,
  "appliedRevision" INTEGER,
  "payloadHash" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "accepted" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_status_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebuild_facebook_native_status_proofs_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_parent_fkey"
    FOREIGN KEY ("workspaceId", "operationId") REFERENCES "rebuild_publication_attempts"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_operation_fkey"
    FOREIGN KEY ("operationId") REFERENCES "rebuild_facebook_native_journal"("operationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_status_proofs_shape_check" CHECK ((
    "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    length("workspaceId") BETWEEN 1 AND 2048 AND "workspaceId" = btrim("workspaceId") AND "workspaceId" !~ '[[:cntrl:]]' AND
    length("operationId") BETWEEN 1 AND 2048 AND "operationId" = btrim("operationId") AND "operationId" !~ '[[:cntrl:]]' AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    length("remoteId") BETWEEN 1 AND 2048 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]' AND
    length("actorId") BETWEEN 1 AND 2048 AND "actorId" = btrim("actorId") AND "actorId" !~ '[[:cntrl:]]' AND
    "observedRevision" >= 0 AND ("appliedRevision" IS NULL OR "appliedRevision" >= 0) AND
    "payloadHash" ~ '^[0-9a-f]{64}$' AND "format" IN ('video', 'reel') AND
    "outcome" IN ('published', 'scheduled', 'processing', 'failed', 'unknown') AND
    ("detail" IS NULL OR (length("detail") <= 128 AND "detail" !~ '[[:cntrl:]]')) AND
    (("accepted" AND "outcome" = 'published' AND "appliedRevision" IS NOT NULL AND
       "appliedRevision" = "observedRevision" + 1) OR
     (NOT "accepted" AND "appliedRevision" IS NULL))
  ) IS TRUE)
);

CREATE INDEX "rebuild_fb_native_proofs_workspace_operation_time_idx"
  ON "rebuild_facebook_native_status_proofs"("workspaceId", "operationId", "observedAt");
CREATE UNIQUE INDEX "rebuild_fb_native_proofs_accepted_revision_key"
  ON "rebuild_facebook_native_status_proofs"("operationId", "observedRevision")
  WHERE "accepted";

CREATE FUNCTION "rebuild_facebook_native_status_proofs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "rebuild_publication_attempts"%ROWTYPE;
  child_row "rebuild_facebook_native_journal"%ROWTYPE;
  expected text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'native status proofs are immutable';
  END IF;

  -- Preserve the shared claim's lock order: parent first, then provider child.
  SELECT * INTO parent_row FROM "rebuild_publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' THEN
    RAISE EXCEPTION 'native status proof requires its Facebook publication claim';
  END IF;

  SELECT * INTO child_row FROM "rebuild_facebook_native_journal"
    WHERE "operationId" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR child_row."workspaceId" IS DISTINCT FROM NEW."workspaceId" OR
     child_row."format" IS DISTINCT FROM NEW."format" OR
     child_row."payloadHash" IS DISTINCT FROM NEW."payloadHash" OR
     child_row."remoteTargetId" IS DISTINCT FROM NEW."remoteTargetId" OR
     child_row."remoteId" IS DISTINCT FROM NEW."remoteId" OR
     NEW."observedRevision" > child_row."revision" THEN
    RAISE EXCEPTION 'native status proof binding does not match its journal child';
  END IF;

  -- actorId is the Root observer recorded on this proof. The journal's actorId
  -- remains the immutable original publication actor and may be different.
  PERFORM 1 FROM "users"
    WHERE "id" = NEW."actorId" AND "isInstanceOwner" AND "disabledAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'native status proof requires an active installation owner';
  END IF;

  IF NEW."accepted" THEN
    IF NEW."appliedRevision" IS DISTINCT FROM child_row."revision" OR
       child_row."state" IS DISTINCT FROM 'confirmed' OR child_row."conflicted" OR
       child_row."remoteId" IS NULL OR child_row."knownIds" <> jsonb_build_array(child_row."remoteId") THEN
      RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
    END IF;
    IF child_row."format" = 'video' THEN expected := ARRAY['video_create'];
    ELSE expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish']; END IF;
    IF jsonb_typeof(child_row."steps") <> 'array' OR
       jsonb_array_length(child_row."steps") <> cardinality(expected) OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements(child_row."steps") WITH ORDINALITY AS s(value, n)
         WHERE s.value->>'phase' IS DISTINCT FROM expected[s.n::integer] OR
           s.value->'dispatched' IS DISTINCT FROM 'true'::jsonb OR
           s.value->'confirmed' IS DISTINCT FROM 'true'::jsonb
       ) THEN
      RAISE EXCEPTION 'accepted native status proof requires the complete confirmed protocol chain';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_status_proofs_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_status_proofs"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_status_proofs_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_status_proofs"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- Provider submission is a durable receipt state that precedes local projection.
-- Preserve the prior state/timestamp branches verbatim and extend them additively.
ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_state_check",
  ADD CONSTRAINT "rebuild_publication_attempts_state_check"
    CHECK ("state" IN ('started', 'uncertain', 'receipt_recorded', 'projected', 'rejected', 'attested_absent', 'submitted'));

ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_reason_check",
  ADD CONSTRAINT "rebuild_publication_attempts_reason_check"
    CHECK ("reason" IS NULL OR "reason" IN ('provider_rejected', 'outcome_unknown', 'provider_receipt', 'external_human_attestation', 'provider_submission'));

ALTER TABLE "rebuild_publication_attempts"
  DROP CONSTRAINT "rebuild_publication_attempts_state_timestamps_check",
  ADD CONSTRAINT "rebuild_publication_attempts_state_timestamps_check"
    CHECK ((
      ("state" = 'started' AND "reason" IS NULL AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'uncertain' AND "reason" = 'outcome_unknown' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'receipt_recorded' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'projected' AND "reason" IN ('provider_receipt', 'external_human_attestation') AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NOT NULL AND (("reason" = 'provider_receipt' AND "attestedAt" IS NULL AND "attestedBy" IS NULL) OR ("reason" = 'external_human_attestation' AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)))
      OR ("state" = 'rejected' AND "reason" = 'provider_rejected' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
      OR ("state" = 'attested_absent' AND "reason" = 'external_human_attestation' AND "remotePostId" IS NULL AND "remoteUrl" IS NULL AND "receiptAt" IS NULL AND "projectedAt" IS NULL AND "attestedAt" IS NOT NULL AND "attestedBy" IS NOT NULL)
      OR ("state" = 'submitted' AND "reason" = 'provider_submission' AND "remotePostId" IS NOT NULL AND "receiptAt" IS NOT NULL AND "projectedAt" IS NULL AND "attestedAt" IS NULL AND "attestedBy" IS NULL)
    ) IS TRUE);

ALTER TABLE "post_templates"
  ADD COLUMN "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "post_templates_firstCommentDelayMinutes_check" CHECK ("firstCommentDelayMinutes" >= 0);

ALTER TABLE "post_versions"
  ADD COLUMN "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "post_versions_firstCommentDelayMinutes_check" CHECK ("firstCommentDelayMinutes" >= 0);

-- OAuth connectors for MCP clients (dynamic client registration + authorization code with PKCE).
-- Additive only: two new tables, no change to existing tables. Replaces the legacy "OAuthClient"/"OAuthCode"
-- tables, which stay untouched until cutover cleanup. Codes are stored only as SHA-256 hashes; the access
-- token is an ordinary scoped mcp_api_keys row created at token exchange (referenced by keyId for reuse revocation).

CREATE TABLE "mcp_oauth_clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "redirectUris" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_clients_name_length" CHECK (char_length("name") BETWEEN 1 AND 60),
  CONSTRAINT "mcp_oauth_clients_redirects" CHECK (cardinality("redirectUris") BETWEEN 1 AND 10)
);

CREATE TABLE "mcp_oauth_codes" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "readFeatures" TEXT[] NOT NULL,
  "writeFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "resourceScope" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "keyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_oauth_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_oauth_codes_challenge_shape" CHECK ("codeChallenge" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "mcp_oauth_codes_write_within_read" CHECK ("writeFeatures" <@ "readFeatures")
);
CREATE UNIQUE INDEX "mcp_oauth_codes_codeHash_key" ON "mcp_oauth_codes"("codeHash");
CREATE INDEX "mcp_oauth_codes_clientId_idx" ON "mcp_oauth_codes"("clientId");
CREATE INDEX "mcp_oauth_codes_expiresAt_idx" ON "mcp_oauth_codes"("expiresAt");
CREATE INDEX "mcp_oauth_clients_createdAt_idx" ON "mcp_oauth_clients"("createdAt");

CREATE TABLE public.rebuild_workspace_exports (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "requestedById" TEXT NOT NULL,
  "apiKeyId" TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','running','ready','failed','expired')),
  "mediaRoot" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  error TEXT,
  bytes INTEGER
);
CREATE INDEX rebuild_workspace_exports_due ON public.rebuild_workspace_exports(status, "createdAt");
CREATE INDEX rebuild_workspace_exports_workspace ON public.rebuild_workspace_exports("workspaceId", "createdAt");
CREATE UNIQUE INDEX rebuild_workspace_exports_pending ON public.rebuild_workspace_exports("workspaceId") WHERE status IN ('requested','running');
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON public.rebuild_workspace_exports
 FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- A deletion outbox deliberately survives its source job/workspace. Erasure first
-- deletes database rows, then removes files, possibly after a process restart.
CREATE TABLE public.rebuild_export_file_cleanups (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "mediaRoot" TEXT NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX rebuild_export_file_cleanups_workspace ON public.rebuild_export_file_cleanups("workspaceId");
CREATE FUNCTION public.rebuild_queue_export_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.rebuild_export_file_cleanups (id, "workspaceId", "mediaRoot")
    VALUES (OLD.id, OLD."workspaceId", OLD."mediaRoot") ON CONFLICT (id) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER rebuild_export_file_cleanup AFTER DELETE ON public.rebuild_workspace_exports
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_queue_export_file_cleanup();

ALTER TABLE rebuild_notifications ADD COLUMN "accountId" TEXT REFERENCES social_accounts(id) ON DELETE CASCADE;
ALTER TABLE rebuild_notifications DROP CONSTRAINT rebuild_notifications_kind_check;
ALTER TABLE rebuild_notifications ADD CONSTRAINT rebuild_notifications_kind_check CHECK (kind IN ('note_mention','mix_dry','publish_failure','connection_expired','token_expiring','approval_request','approval_decision','inbox_digest','queue_empty','draft_updated','moderation_alert','negative_spike'));
ALTER TABLE rebuild_notifications DROP CONSTRAINT rebuild_notifications_context_shape;
ALTER TABLE rebuild_notifications ADD CONSTRAINT rebuild_notifications_context_shape CHECK (
 (kind = 'note_mention' AND "postId" IS NOT NULL AND "noteId" IS NOT NULL)
 OR (kind IN ('mix_dry','inbox_digest','queue_empty','moderation_alert','negative_spike') AND "targetId" IS NOT NULL)
 OR (kind IN ('publish_failure','approval_request','approval_decision','draft_updated') AND "postId" IS NOT NULL)
 OR (kind IN ('connection_expired','token_expiring') AND "accountId" IS NOT NULL)
);

-- Channel labels are customer metadata, independent of provider categories and post labels.
CREATE TABLE rebuild_channel_profiles (
  "targetId" TEXT PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  labels TEXT[] NOT NULL DEFAULT '{}'
);

-- Let the native status-proof ledger record observations of Facebook Story
-- publications. Additive: the table, its rows and every other rule are kept.
-- A Story keeps two journal identities (the staged photo/video and the final
-- Story post), so its accepted proof requires exactly those two, one of which is
-- the final identity, instead of the sole-identity rule used by Video and Reel.
ALTER TABLE "rebuild_facebook_native_status_proofs"
  DROP CONSTRAINT "rebuild_facebook_native_status_proofs_shape_check";

ALTER TABLE "rebuild_facebook_native_status_proofs"
  ADD CONSTRAINT "rebuild_facebook_native_status_proofs_shape_check" CHECK ((
    "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    length("workspaceId") BETWEEN 1 AND 2048 AND "workspaceId" = btrim("workspaceId") AND "workspaceId" !~ '[[:cntrl:]]' AND
    length("operationId") BETWEEN 1 AND 2048 AND "operationId" = btrim("operationId") AND "operationId" !~ '[[:cntrl:]]' AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    length("remoteId") BETWEEN 1 AND 2048 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]' AND
    length("actorId") BETWEEN 1 AND 2048 AND "actorId" = btrim("actorId") AND "actorId" !~ '[[:cntrl:]]' AND
    "observedRevision" >= 0 AND ("appliedRevision" IS NULL OR "appliedRevision" >= 0) AND
    "payloadHash" ~ '^[0-9a-f]{64}$' AND "format" IN ('video', 'reel', 'story_photo', 'story_video') AND
    "outcome" IN ('published', 'scheduled', 'processing', 'failed', 'unknown') AND
    ("detail" IS NULL OR (length("detail") <= 128 AND "detail" !~ '[[:cntrl:]]')) AND
    (("accepted" AND "outcome" = 'published' AND "appliedRevision" IS NOT NULL AND
       "appliedRevision" = "observedRevision" + 1) OR
     (NOT "accepted" AND "appliedRevision" IS NULL))
  ) IS TRUE);

CREATE OR REPLACE FUNCTION "rebuild_facebook_native_status_proofs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_row "rebuild_publication_attempts"%ROWTYPE;
  child_row "rebuild_facebook_native_journal"%ROWTYPE;
  expected text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'native status proofs are immutable';
  END IF;

  -- Preserve the shared claim's lock order: parent first, then provider child.
  SELECT * INTO parent_row FROM "rebuild_publication_attempts"
    WHERE "id" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR parent_row."provider" IS DISTINCT FROM 'facebook' THEN
    RAISE EXCEPTION 'native status proof requires its Facebook publication claim';
  END IF;

  SELECT * INTO child_row FROM "rebuild_facebook_native_journal"
    WHERE "operationId" = NEW."operationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR child_row."workspaceId" IS DISTINCT FROM NEW."workspaceId" OR
     child_row."format" IS DISTINCT FROM NEW."format" OR
     child_row."payloadHash" IS DISTINCT FROM NEW."payloadHash" OR
     child_row."remoteTargetId" IS DISTINCT FROM NEW."remoteTargetId" OR
     child_row."remoteId" IS DISTINCT FROM NEW."remoteId" OR
     NEW."observedRevision" > child_row."revision" THEN
    RAISE EXCEPTION 'native status proof binding does not match its journal child';
  END IF;

  -- actorId is the Root observer recorded on this proof. The journal's actorId
  -- remains the immutable original publication actor and may be different.
  PERFORM 1 FROM "users"
    WHERE "id" = NEW."actorId" AND "isInstanceOwner" AND "disabledAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'native status proof requires an active installation owner';
  END IF;

  IF NEW."accepted" THEN
    IF NEW."appliedRevision" IS DISTINCT FROM child_row."revision" OR
       child_row."state" IS DISTINCT FROM 'confirmed' OR child_row."conflicted" OR
       child_row."remoteId" IS NULL THEN
      RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
    END IF;
    IF child_row."format" IN ('video', 'reel') THEN
      IF child_row."knownIds" <> jsonb_build_array(child_row."remoteId") THEN
        RAISE EXCEPTION 'accepted native status proof requires the sole confirmed final identity at the current revision';
      END IF;
    ELSIF jsonb_typeof(child_row."knownIds") IS DISTINCT FROM 'array' OR
          jsonb_array_length(child_row."knownIds") <> 2 OR
          NOT (child_row."knownIds" @> jsonb_build_array(child_row."remoteId")) THEN
      RAISE EXCEPTION 'accepted native Story proof requires exactly the staged media and the confirmed final Story identity';
    END IF;
    IF child_row."format" = 'video' THEN expected := ARRAY['video_create'];
    ELSIF child_row."format" = 'reel' THEN expected := ARRAY['upload_start', 'upload_transfer', 'reel_finish'];
    ELSIF child_row."format" = 'story_photo' THEN expected := ARRAY['photo_upload', 'story_create'];
    ELSE expected := ARRAY['upload_start', 'upload_transfer', 'story_finish']; END IF;
    IF jsonb_typeof(child_row."steps") <> 'array' OR
       jsonb_array_length(child_row."steps") <> cardinality(expected) OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements(child_row."steps") WITH ORDINALITY AS s(value, n)
         WHERE s.value->>'phase' IS DISTINCT FROM expected[s.n::integer] OR
           s.value->'dispatched' IS DISTINCT FROM 'true'::jsonb OR
           s.value->'confirmed' IS DISTINCT FROM 'true'::jsonb
       ) THEN
      RAISE EXCEPTION 'accepted native status proof requires the complete confirmed protocol chain';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Reviews in the Inbox can be resolved and reopened locally, like conversations and comments.
ALTER TABLE page_reviews ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- Extend the existing durable creation journal; no automatic replay of held writes.
ALTER TABLE ads_management_operations DROP CONSTRAINT ads_operations_operation_kind;
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_operation_kind CHECK (
  "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create','creative.create')
);
ALTER TABLE ads_management_operations DROP CONSTRAINT "ads_management_operations_objectType_check";
ALTER TABLE ads_management_operations ADD CONSTRAINT "ads_management_operations_objectType_check" CHECK (
  "objectType" IN ('campaign','adset','ad','creative')
);
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_creative_shape CHECK (
  ("objectType" = 'creative') = ("operationType" = 'creative.create')
);
-- Durable intermediate receipts are independently committed to the existing audit journal.
CREATE INDEX ads_creation_receipt_lookup ON root_activities ((detail->>'workspaceId'), (detail->>'operationId'), "createdAt" DESC)
  WHERE action = 'ads.creation_receipt';

-- Workspace branding only. Originals and legacy per-channel watermark JSON are untouched.
CREATE TABLE rebuild_workspace_watermarks (
  "workspaceId" text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  logo bytea NOT NULL,
  position text NOT NULL CHECK (position IN ('northwest', 'northeast', 'center', 'southwest', 'southeast')),
  opacity double precision NOT NULL CHECK (opacity >= 0 AND opacity <= 1),
  scale double precision NOT NULL CHECK (scale >= 0.01 AND scale <= 1)
);
CREATE TRIGGER rebuild_workspace_watermarks_purge_gate
BEFORE INSERT OR UPDATE ON rebuild_workspace_watermarks
FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- Additive; existing legacy labels remain untrusted until classified with provenance.
ALTER TABLE post_comments
  ADD COLUMN "sentimentAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "sentimentProvenance" JSONB;

-- A provider edit invalidates the old classification atomically, including legacy writes.
CREATE FUNCTION rebuild_invalidate_comment_sentiment() RETURNS trigger AS $$
BEGIN
  IF NEW.message IS DISTINCT FROM OLD.message THEN
    NEW.sentiment := NULL;
    NEW."sentimentAttemptedAt" := NULL;
    NEW."sentimentProvenance" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rebuild_comment_sentiment_invalidation
  BEFORE UPDATE ON post_comments FOR EACH ROW
  EXECUTE FUNCTION rebuild_invalidate_comment_sentiment();
CREATE INDEX post_comments_sentiment_pending_idx ON post_comments ("sentimentAttemptedAt", "createdTime") WHERE sentiment IS NULL;

-- Separate person-only credentials: no workspace or write grants can be stored.
CREATE TABLE person_mcp_keys (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "tokenPrefix" TEXT NOT NULL,
  "readFeature" TEXT NOT NULL DEFAULT 'agency/overview' CHECK ("readFeature" = 'agency/overview'),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX person_mcp_keys_user_active ON person_mcp_keys ("userId", "expiresAt") WHERE "revokedAt" IS NULL;

-- Facebook native provider-held schedule changes (cancel / reschedule of a
-- published native Video) are child intents of the native journal. One row per
-- change, bound to the journal row, its workspace and the immutable remote id.
-- Content-free protocol evidence only. A repeat can never dispatch a second write.
CREATE UNIQUE INDEX "rebuild_facebook_native_journal_workspaceId_operationId_key"
  ON "rebuild_facebook_native_journal"("workspaceId", "operationId");

CREATE TABLE "rebuild_facebook_native_schedule_changes" (
  "changeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "publishOperationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "scheduledUnix" BIGINT,
  "remoteId" TEXT NOT NULL,
  "remoteTargetId" TEXT NOT NULL,
  "ownerToken" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'started',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_pkey" PRIMARY KEY ("changeId"),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_journal_fkey"
    FOREIGN KEY ("workspaceId", "publishOperationId") REFERENCES "rebuild_facebook_native_journal"("workspaceId", "operationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rebuild_facebook_native_schedule_changes_kind_check" CHECK ((
    ("kind" = 'cancel' AND "scheduledUnix" IS NULL AND "changeId" = "publishOperationId" || ':cancel') OR
    ("kind" = 'reschedule' AND "scheduledUnix" > 0 AND "changeId" = "publishOperationId" || ':reschedule:' || "scheduledUnix"::text)
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_bounds_check" CHECK ((
    length("changeId") BETWEEN 1 AND 4200 AND "changeId" !~ '[[:cntrl:]]' AND
    length("remoteId") BETWEEN 1 AND 128 AND "remoteId" = btrim("remoteId") AND "remoteId" !~ '[[:cntrl:]]' AND
    length("remoteTargetId") BETWEEN 1 AND 2048 AND "remoteTargetId" = btrim("remoteTargetId") AND "remoteTargetId" !~ '[[:cntrl:]]' AND
    "revision" >= 0 AND "createdAt" <= "updatedAt"
  ) IS TRUE),
  CONSTRAINT "rebuild_facebook_native_schedule_changes_state_check"
    CHECK ("state" IN ('started', 'published', 'rejected', 'uncertain', 'deleted'))
);

CREATE INDEX "rebuild_facebook_native_schedule_changes_publish_idx"
  ON "rebuild_facebook_native_schedule_changes"("workspaceId", "publishOperationId", "createdAt");

CREATE FUNCTION "rebuild_facebook_native_schedule_changes_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  journal_row "rebuild_facebook_native_journal"%ROWTYPE;
BEGIN
  SELECT * INTO journal_row FROM "rebuild_facebook_native_journal"
    WHERE "operationId" = NEW."publishOperationId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
  IF NOT FOUND OR journal_row."format" <> 'video' OR journal_row."remoteId" IS DISTINCT FROM NEW."remoteId" OR
     journal_row."remoteTargetId" <> NEW."remoteTargetId" THEN
    RAISE EXCEPTION 'schedule change does not match its native Video journal';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0 OR NEW."state" <> 'started' THEN
      RAISE EXCEPTION 'schedule change must begin started';
    END IF;
    IF journal_row."state" NOT IN ('published', 'confirmed') OR journal_row."conflicted" THEN
      RAISE EXCEPTION 'schedule change requires a published, unconflicted native Video';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."changeId", NEW."workspaceId", NEW."publishOperationId", NEW."kind", NEW."scheduledUnix", NEW."remoteId", NEW."remoteTargetId", NEW."ownerToken", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."changeId", OLD."workspaceId", OLD."publishOperationId", OLD."kind", OLD."scheduledUnix", OLD."remoteId", OLD."remoteTargetId", OLD."ownerToken", OLD."createdAt") THEN
    RAISE EXCEPTION 'schedule change binding is immutable';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'schedule change revision must advance by one'; END IF;
  IF NEW."updatedAt" < OLD."updatedAt" THEN RAISE EXCEPTION 'schedule change timestamp cannot move backwards'; END IF;
  IF NOT (
    OLD."state" = NEW."state" OR
    (OLD."state" = 'started' AND NEW."state" IN ('rejected', 'uncertain')) OR
    (OLD."state" = 'started' AND NEW."kind" = 'cancel' AND NEW."state" = 'deleted') OR
    (OLD."state" = 'started' AND NEW."kind" = 'reschedule' AND NEW."state" = 'published')
  ) THEN RAISE EXCEPTION 'invalid schedule change state transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rebuild_facebook_native_schedule_changes_guard_trigger"
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_schedule_changes"
  FOR EACH ROW EXECUTE FUNCTION "rebuild_facebook_native_schedule_changes_guard"();

DO $$
BEGIN
  IF to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NULL THEN
    RAISE EXCEPTION 'Shared workspace purge write gate prerequisite is missing';
  END IF;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON "rebuild_facebook_native_schedule_changes"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- Scheduling place per destination (post target): 'application' (our worker publishes at the time)
-- or 'remote' (the destination's platform holds the post). Additive and nullable: NULL means the
-- destination follows the post-level choice stored in posts."publishMode" (legacy and existing rows).
ALTER TABLE "post_targets" ADD COLUMN "scheduleMode" TEXT;
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_scheduleMode_check"
  CHECK ("scheduleMode" IS NULL OR "scheduleMode" IN ('application', 'remote'));

BEGIN;
-- Provider job state belongs outside the Root configuration registry.
-- Direct workspace FK participates in the catalog-driven export and erasure.
CREATE TABLE "rebuild_facebook_sync_cursors" (
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "providerId" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post_history')),
  cursor JSONB NOT NULL CHECK (jsonb_typeof(cursor) = 'object'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "targetId", kind)
);

CREATE FUNCTION rebuild_facebook_sync_cursor_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM targets WHERE id = NEW."targetId" AND "workspaceId" = NEW."workspaceId" AND "providerId" = NEW."providerId") THEN
    RAISE EXCEPTION 'Facebook cursor target binding mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rebuild_facebook_sync_cursor_binding BEFORE INSERT OR UPDATE ON rebuild_facebook_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION rebuild_facebook_sync_cursor_binding();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON rebuild_facebook_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

-- Exact joined keys avoid parsing IDs using dots. Only current target bindings
-- are reusable; stale/deleted target progress is disposable job state.
INSERT INTO rebuild_facebook_sync_cursors ("workspaceId", "targetId", "providerId", kind, cursor, "updatedAt")
SELECT t."workspaceId", t.id, t."providerId", 'post_history', s.value, s."updatedAt"
FROM app_settings s JOIN targets t ON s.key = 'facebook.history.' || t."workspaceId" || '.' || t.id || '.' || t."providerId"
WHERE NOT s.encrypted AND jsonb_typeof(s.value) = 'object';
DELETE FROM app_settings WHERE key LIKE 'facebook.history.%';

CREATE INDEX rebuild_facebook_sync_cursors_target_idx ON rebuild_facebook_sync_cursors ("targetId");
COMMIT;

BEGIN;
-- Recipe sources read from a WordPress site (read-only, by the application) and a ledger of what was planned.
-- Direct workspace FKs participate in the catalog-driven export and erasure.
CREATE TABLE "wordpress_recipe_sources" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  "allTargets" BOOLEAN NOT NULL DEFAULT TRUE,
  "targetIds" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("targetIds") = 'array'),
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastSummary" JSONB CHECK ("lastSummary" IS NULL OR jsonb_typeof("lastSummary") = 'object'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "wordpress_recipe_sources_workspace_key" ON "wordpress_recipe_sources" ("workspaceId");

-- One row per (source, page, slot): the unique key is the exactly-once claim, taken before any post is created.
-- 'claimed' is an unfinished claim; a stale one becomes 'uncertain' and is never retried automatically.
CREATE TABLE "wordpress_recipe_plans" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceId" TEXT NOT NULL REFERENCES "wordpress_recipe_sources"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "wpPostId" TEXT NOT NULL,
  "slotAt" TIMESTAMP(3) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'planned', 'uncertain', 'failed')),
  "postId" TEXT,
  title TEXT NOT NULL DEFAULT '',
  permalink TEXT,
  reason TEXT,
  skipped JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(skipped) = 'array'),
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (state <> 'planned' OR "postId" IS NOT NULL)
);
CREATE UNIQUE INDEX "wordpress_recipe_plans_slot_key" ON "wordpress_recipe_plans" ("sourceId", "targetId", "slotAt");
CREATE INDEX "wordpress_recipe_plans_recipe_idx" ON "wordpress_recipe_plans" ("sourceId", "wpPostId");
CREATE INDEX "wordpress_recipe_plans_workspace_slot_idx" ON "wordpress_recipe_plans" ("workspaceId", "slotAt");

CREATE FUNCTION rebuild_wordpress_recipe_plan_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM targets WHERE id = NEW."targetId" AND "workspaceId" = NEW."workspaceId")
     OR NOT EXISTS (SELECT 1 FROM "wordpress_recipe_sources" WHERE id = NEW."sourceId" AND "workspaceId" = NEW."workspaceId") THEN
    RAISE EXCEPTION 'WordPress recipe plan binding mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rebuild_wordpress_recipe_plan_binding BEFORE INSERT OR UPDATE ON "wordpress_recipe_plans"
  FOR EACH ROW EXECUTE FUNCTION rebuild_wordpress_recipe_plan_binding();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "wordpress_recipe_plans"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "wordpress_recipe_sources"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
COMMIT;

-- Persistence idempotency for sampled minutes; daily totals remain legacy-compatible.
CREATE TABLE rebuild_uptime_samples (
  minute TIMESTAMP(3) NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('app', 'worker')),
  PRIMARY KEY (minute, component)
);

CREATE TABLE rebuild_monitoring_deliveries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unavailable', 'uncertain')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX rebuild_monitoring_deliveries_status_created ON rebuild_monitoring_deliveries(status, "createdAt");

-- Content-free transactional outbox. Transport claims commit before external I/O;
-- a lost claim becomes uncertain, never pending again.
CREATE UNIQUE INDEX chat_channels_id_workspace_id ON chat_channels(id, "workspaceId");

CREATE TABLE rebuild_chat_deliveries (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  event TEXT NOT NULL,
  source JSONB,
  "operatorOnly" BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','rejected','uncertain','cancelled')),
  "claimedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("channelId", "workspaceId") REFERENCES chat_channels(id, "workspaceId") ON DELETE CASCADE,
  UNIQUE ("workspaceId", "channelId", "eventId", event)
);
CREATE INDEX rebuild_chat_deliveries_pending ON rebuild_chat_deliveries(status, "createdAt");

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public.rebuild_chat_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_workspace_write();

-- OAuthCode is a legacy compatibility table without a workspace FK. Use the
-- same parent lock/check as directly owned tables. Do not add FKs over unaudited
-- historical orphan records. Deletes remain allowed for erasure/account cleanup.
CREATE FUNCTION public.rebuild_reject_purging_legacy_oauth_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = NEW."workspaceId" FOR SHARE;
  -- No FK exists here to reject a writer resuming after Root removes a workspace.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
      WHERE "workspaceId" = NEW."workspaceId" AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public."OAuthCode"
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_legacy_oauth_write();

-- Profiles inherit ownership from targets. Parent-first locking matches erasure:
-- resolve the tenant, lock its workspace, then recheck/lock the target. Locking
-- the target first would deadlock against a purge that already owns the workspace.
CREATE FUNCTION public.rebuild_reject_purging_channel_profile_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_workspace TEXT;
BEGIN
  SELECT "workspaceId" INTO owner_workspace FROM public.targets WHERE id = NEW."targetId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Channel unavailable' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = owner_workspace FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.targets
    WHERE id = NEW."targetId" AND "workspaceId" = owner_workspace FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Channel ownership changed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_data_purges
      WHERE "workspaceId" = owner_workspace AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Workspace data deletion is in progress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rebuild_workspace_purge_write_gate
  BEFORE INSERT OR UPDATE ON public.rebuild_channel_profiles
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_reject_purging_channel_profile_write();

-- Posts: workspace equality followed by the complete, deterministic list ordering.
-- The same btree supports ascending Home/queue and descending Posts scans.
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_schedule_order
  ON posts ("workspaceId", "scheduledAt", "createdAt", id);

-- Status-filtered lists (including Home's upcoming scheduled posts).
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_status_schedule_order
  ON posts ("workspaceId", status, "scheduledAt", "createdAt", id);

-- Oldest-created lists cannot use a schedule-leading index for their ordering.
CREATE INDEX IF NOT EXISTS rebuild_posts_workspace_created_order
  ON posts ("workspaceId", "createdAt", id);

-- Analytics range reads constrain target and endTime without constraining metric.
-- The existing (targetId, metric, endTime) index cannot narrow that date range.
CREATE INDEX IF NOT EXISTS rebuild_page_insights_target_time_metric
  ON page_insights ("targetId", "endTime", metric);

-- Optional neutral provider observations; existing rows retain unknown metadata.
ALTER TABLE conversations ADD COLUMN "inboxMetadata" JSONB;
ALTER TABLE conversation_messages ADD COLUMN "inboxMetadata" JSONB;
ALTER TABLE post_comments ADD COLUMN "inboxMetadata" JSONB;

-- Optional acceleration for existing literal ILIKE searches. No data changes.
-- Managed installations may forbid extension installation or omit its package.
-- Those cases must not prevent the rest of the release from migrating.
DO $migration$
DECLARE
  extension_schema text;
  search_column record;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
      RAISE NOTICE 'pg_trgm is unavailable; search indexes were not installed';
  END;

  SELECT n.nspname INTO extension_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';
  IF extension_schema IS NULL THEN
    RETURN;
  END IF;

  -- Match the unwrapped text columns used by ILIKE, including either side of
  -- the person/text OR. Resolve the opclass from the installed extension schema.
  FOR search_column IN
    SELECT * FROM (VALUES
      ('posts', 'message', 'posts_message_trgm_idx'),
      ('conversations', 'snippet', 'conversations_snippet_trgm_idx'),
      ('conversation_messages', 'message', 'conversation_messages_message_trgm_idx'),
      ('conversation_messages', 'fromName', 'conversation_messages_author_trgm_idx'),
      ('post_comments', 'message', 'post_comments_message_trgm_idx'),
      ('post_comments', 'fromName', 'post_comments_author_trgm_idx'),
      ('page_reviews', 'reviewText', 'page_reviews_text_trgm_idx'),
      ('page_reviews', 'reviewerName', 'page_reviews_author_trgm_idx')
    ) AS columns(table_name, column_name, index_name)
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)',
      search_column.index_name, search_column.table_name, search_column.column_name, extension_schema);
  END LOOP;
END;
$migration$;

-- Add paused-ad creation to the existing request-id / open-object journal.
-- Preserve all recorded requests, receipts, states, indexes and resolution guards.
ALTER TABLE ads_management_operations DROP CONSTRAINT ads_operations_operation_kind;
ALTER TABLE ads_management_operations ADD CONSTRAINT ads_operations_operation_kind CHECK (
  "operationType" IN ('status.set','budget.set','rename','creative.assign','delete','campaign.create','adset.create','creative.create','ad.create')
);

CREATE TABLE rebuild_writing_agents (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, instructions text NOT NULL, voice text NOT NULL,
 UNIQUE (id, "workspaceId"),
 "createdById" text NOT NULL REFERENCES users(id), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rebuild_writing_agents ("workspaceId", id);
CREATE TABLE rebuild_writing_agent_runs (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "agentId" text,
 FOREIGN KEY ("agentId", "workspaceId") REFERENCES rebuild_writing_agents(id, "workspaceId") ON DELETE SET NULL ("agentId"),
 "createdById" text NOT NULL REFERENCES users(id), kind text NOT NULL CHECK (kind IN ('post', 'reply')),
 status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')), "errorCode" text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "completedAt" timestamptz
);
CREATE INDEX ON rebuild_writing_agent_runs ("workspaceId", "createdAt" DESC, id);

CREATE TABLE rebuild_post_exports (
 id text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 filters jsonb NOT NULL, ceiling jsonb NOT NULL, scope text NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','processing','ready','failed')),
 "expiresAt" timestamptz NOT NULL, "leaseUntil" timestamptz, token text, csv text,
 attempts integer NOT NULL DEFAULT 0, "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
 "lastError" text, "completedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE (id, "workspaceId", "userId")
);
CREATE INDEX ON rebuild_post_exports (status, "nextAttemptAt", "createdAt");
CREATE TABLE rebuild_post_export_runs (
 id text PRIMARY KEY, "exportId" text NOT NULL REFERENCES rebuild_post_exports(id) ON DELETE CASCADE,
 "workspaceId" text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 attempt integer NOT NULL, outcome text NOT NULL CHECK (outcome IN ('running','succeeded','retry','failed','expired')),
 "errorCode" text, "startedAt" timestamptz NOT NULL DEFAULT now(), "finishedAt" timestamptz,
 "postCount" integer, "byteLength" integer, UNIQUE ("exportId", attempt),
 FOREIGN KEY ("exportId", "workspaceId", "userId") REFERENCES rebuild_post_exports(id, "workspaceId", "userId") ON DELETE CASCADE
);
CREATE INDEX ON rebuild_post_export_runs ("workspaceId", "exportId", attempt);

-- Inbox private-note @mentions: store the resolved member ids on the note so delivery can re-verify them.
ALTER TABLE inbox_notes ADD COLUMN IF NOT EXISTS "mentionIds" TEXT[] NOT NULL DEFAULT '{}';
-- Per-task checklist items for the Tasks module (design v2 B7 leftover, lane 56).
-- Additive: one new table. Existing rows are not rewritten.
--
-- Workspace boundary: an item's (taskId, workspaceId) must name an existing
-- task of that same workspace. The composite foreign key makes a cross-workspace
-- item unrepresentable, whatever code path writes it.
-- Lifecycle:
--   * deleting a task or its workspace deletes the items (ON DELETE CASCADE),
--     so workspace erasure and exports need no table-specific handling;
--   * deleting a user keeps the item but clears the author (ON DELETE SET NULL).

CREATE TABLE "task_checklist_items" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id"),
  -- Ceiling matches the largest value Root may configure for tasks.checklistItemMaxCharacters.
  CONSTRAINT "task_checklist_items_text_check" CHECK (char_length(btrim("text")) > 0 AND char_length("text") <= 20000)
);

-- Ordered checklist of one task, and the author lookup used by SET NULL.
CREATE INDEX "task_checklist_items_taskId_position_id_idx" ON "task_checklist_items"("taskId", "position", "id");
CREATE INDEX "task_checklist_items_workspaceId_idx" ON "task_checklist_items"("workspaceId");
CREATE INDEX "task_checklist_items_createdById_idx" ON "task_checklist_items"("createdById");

ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_fkey"
  FOREIGN KEY ("taskId", "workspaceId") REFERENCES "tasks"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New tables must join the workspace purge write gate, otherwise an item could
-- be written while the workspace is being erased.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "task_checklist_items"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
-- Optional-area activation for Tasks (design v2 B7 leftover, lane 56; 01 section 4):
-- a workspace owner can show the Tasks area in Settings › Workspace before the
-- workspace has any task. Additive nullable-safe column: existing rows read as
-- not activated, and the area still appears once the workspace has a task.

ALTER TABLE "workspaces" ADD COLUMN "tasksAreaEnabled" BOOLEAN NOT NULL DEFAULT false;
-- Supervised autopilot tiers, per-language post variants and link-preview cache (idea batch 2).
-- Additive only: three new tables plus one nullable column. Existing rows are not rewritten.
--
-- Workspace boundary: every new workspace-owned row references workspaces(id) with
-- ON DELETE CASCADE, so workspace erasure and exports need no table-specific handling.
-- Lifecycle:
--   * deleting a workspace deletes its autopilot policy and variants (ON DELETE CASCADE);
--   * deleting a post deletes its language variants (ON DELETE CASCADE);
--   * deleting a user keeps the autopilot policy but clears the author (ON DELETE SET NULL);
--   * link_preview_cache is installation-wide and expires by fetchedAt/expiresAt; no FK.

CREATE TABLE "autopilot_policies" (
  "workspaceId" TEXT NOT NULL,
  "tier" TEXT NOT NULL DEFAULT 'assisted',
  "guardrails" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "autopilot_policies_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "autopilot_policies_tier_check" CHECK ("tier" IN ('manual', 'assisted', 'supervised_auto')),
  CONSTRAINT "autopilot_policies_guardrails_check" CHECK (jsonb_typeof("guardrails") = 'object')
);

CREATE TABLE "post_language_variants" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_language_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_language_variants_post_locale_unique" UNIQUE ("postId", "locale"),
  -- BCP 47 short tags only: language, optionally with a region (en, fr, fr-CA).
  CONSTRAINT "post_language_variants_locale_check" CHECK ("locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT "post_language_variants_message_check" CHECK (char_length(btrim("message")) > 0 AND char_length("message") <= 100000)
);

CREATE INDEX "post_language_variants_postId_idx" ON "post_language_variants"("postId");
CREATE INDEX "post_language_variants_workspaceId_idx" ON "post_language_variants"("workspaceId");

ALTER TABLE "post_language_variants" ADD CONSTRAINT "post_language_variants_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_language_variants" ADD CONSTRAINT "post_language_variants_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Effective destination language for variant selection. Null follows the workspace default
-- locale; the variant fallback rule is documented in publishing/server/post-variants.ts.
ALTER TABLE "targets" ADD COLUMN "locale" TEXT;
ALTER TABLE "targets" ADD CONSTRAINT "targets_locale_check" CHECK ("locale" IS NULL OR "locale" ~ '^[a-z]{2}(-[A-Z]{2})?$');

CREATE TABLE "link_preview_cache" (
  "urlHash" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "preview" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "link_preview_cache_pkey" PRIMARY KEY ("urlHash"),
  CONSTRAINT "link_preview_cache_preview_check" CHECK (jsonb_typeof("preview") = 'object')
);
CREATE INDEX "link_preview_cache_expiresAt_idx" ON "link_preview_cache"("expiresAt");

-- New tables must join the workspace purge write gate, otherwise a row could
-- be written while the workspace is being erased. The shared cache table has no
-- workspace column, so it stays outside the gate like other shared storage.
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "autopilot_policies"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "post_language_variants"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
-- Engagement batch: metric alert rules with worker-evaluated firings, new
-- notification email switches, and full-text search indexes over stored
-- inbox messages and comments. Additive only: two new tables, three new
-- nullable-safe columns with defaults, two expression indexes. Existing rows
-- are not rewritten.
--
-- Workspace boundary: every new workspace-owned row references workspaces(id)
-- with ON DELETE CASCADE, so workspace erasure and exports need no
-- table-specific handling (discovery is FK-based; see
-- src/server/data-control/index.ts).
-- Lifecycle:
--   * deleting a workspace deletes its alert rules and firings (CASCADE);
--   * deleting a channel (target) deletes its alert rules and their firings;
--   * deleting a user keeps rules/firings but clears the author (SET NULL);
--   * notification_settings switches default to true (email on) for new rows;
--     existing rows gain the same default, matching the other alert switches.

CREATE TABLE "metric_alert_rules" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metric_alert_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_alert_rules_metric_check" CHECK ("metric" IN ('followers', 'views', 'engagements', 'posts')),
  CONSTRAINT "metric_alert_rules_operator_check" CHECK ("operator" IN ('above', 'below')),
  CONSTRAINT "metric_alert_rules_threshold_check" CHECK ("threshold" >= 0 AND "threshold" <= 1000000000),
  CONSTRAINT "metric_alert_rules_window_check" CHECK ("windowDays" IN (7, 30)),
  CONSTRAINT "metric_alert_rules_name_check" CHECK (char_length(btrim("name")) > 0 AND char_length("name") <= 80)
);

CREATE TABLE "metric_alert_firings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "actual" DOUBLE PRECISION NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'fired',
  "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "metric_alert_firings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_alert_firings_state_check" CHECK ("state" IN ('fired', 'resolved'))
);

-- One open firing per rule; resolved history is kept.
CREATE UNIQUE INDEX "metric_alert_firings_open_rule_uniq" ON "metric_alert_firings"("ruleId") WHERE "state" = 'fired';
CREATE INDEX "metric_alert_firings_workspace_idx" ON "metric_alert_firings"("workspaceId", "firedAt" DESC);
CREATE INDEX "metric_alert_rules_workspace_idx" ON "metric_alert_rules"("workspaceId", "targetId");

ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_rules" ADD CONSTRAINT "metric_alert_rules_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metric_alert_firings" ADD CONSTRAINT "metric_alert_firings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_alert_firings" ADD CONSTRAINT "metric_alert_firings_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "metric_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_rules"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_firings"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

ALTER TABLE "notification_settings"
  ADD COLUMN "onMetricAlert" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onReportDelivered" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onTriageAssigned" BOOLEAN NOT NULL DEFAULT true;

-- Ranked full-text search over stored inbox content. The `simple`
-- configuration keeps matching predictable across English and French text
-- without language-specific stemming or stop words.
CREATE INDEX "conversation_messages_fts_idx" ON "conversation_messages"
  USING gin (to_tsvector('simple', coalesce("message", '') || ' ' || coalesce("fromName", '')));
CREATE INDEX "post_comments_fts_idx" ON "post_comments"
  USING gin (to_tsvector('simple', coalesce("message", '') || ' ' || coalesce("fromName", '')));
-- Platform/moat batch: Meta inbound-webhook delivery log and Analytics
-- precomputed daily/weekly rollups. Additive only: four new tables.
-- Existing rows are not rewritten.
--
-- Workspace boundary:
--   * meta_webhook_deliveries is installation operational history (like
--     rebuild_sync_runs): content-free delivery receipts (ids, kinds,
--     verbs, counts — never message text), retained under the Root
--     meta.webhookDeliveryRetentionDays bound. No workspace FK on purpose:
--     one event fans out to every workspace holding the Page, and unmatched
--     events belong to no workspace.
--   * analytics_rollup_daily / analytics_rollup_weekly are workspace-owned
--     derivatives of stored insights (one value per target/metric/day or
--     week). Every row references workspaces(id) and targets(id) with
--     ON DELETE CASCADE, so workspace erasure and channel deletion need no
--     table-specific handling (discovery is FK-based; see
--     src/server/data-control/index.ts).
--   * analytics_rollup_runs records worker coverage (window + targets) so
--     readers can prefer rollups only when a completed run covers the
--     request, and otherwise fall back to detailed stored reads.
-- Lifecycle:
--   * deleting a workspace deletes its rollup rows and run records (CASCADE);
--   * deleting a channel (target) deletes its rollup rows (CASCADE);
--   * run records keep no target FK (historical coverage snapshot only).

CREATE TABLE "meta_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "eventKind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "matchedTargets" INTEGER NOT NULL DEFAULT 0,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_webhook_deliveries_event_uniq" UNIQUE ("eventId"),
  CONSTRAINT "meta_webhook_deliveries_status_check" CHECK ("status" IN ('accepted', 'duplicate', 'unmatched', 'ignored')),
  CONSTRAINT "meta_webhook_deliveries_kind_check" CHECK ("eventKind" IN ('feed_post', 'feed_comment', 'message', 'unknown'))
);
CREATE INDEX "meta_webhook_deliveries_provider_idx" ON "meta_webhook_deliveries"("provider", "receivedAt" DESC);

CREATE TABLE "analytics_rollup_daily" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'day',
  "day" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "samples" INTEGER NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_daily_kind_check" CHECK ("kind" IN ('flow', 'stock')),
  CONSTRAINT "analytics_rollup_daily_samples_check" CHECK ("samples" >= 1)
);
CREATE UNIQUE INDEX "analytics_rollup_daily_target_uniq" ON "analytics_rollup_daily"("targetId", "metric", "period", "day");
CREATE INDEX "analytics_rollup_daily_workspace_idx" ON "analytics_rollup_daily"("workspaceId", "provider", "day");

CREATE TABLE "analytics_rollup_weekly" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'day',
  "weekStart" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "samples" INTEGER NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_weekly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_weekly_kind_check" CHECK ("kind" IN ('flow', 'stock')),
  CONSTRAINT "analytics_rollup_weekly_samples_check" CHECK ("samples" >= 1)
);
CREATE UNIQUE INDEX "analytics_rollup_weekly_target_uniq" ON "analytics_rollup_weekly"("targetId", "metric", "period", "weekStart");
CREATE INDEX "analytics_rollup_weekly_workspace_idx" ON "analytics_rollup_weekly"("workspaceId", "provider", "weekStart");

CREATE TABLE "analytics_rollup_runs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "granularity" TEXT NOT NULL,
  "windowFrom" TIMESTAMP(3) NOT NULL,
  "windowTo" TIMESTAMP(3) NOT NULL,
  "targetIds" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL,
  "examined" INTEGER NOT NULL DEFAULT 0,
  "written" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_rollup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollup_runs_granularity_check" CHECK ("granularity" IN ('daily', 'weekly')),
  CONSTRAINT "analytics_rollup_runs_status_check" CHECK ("status" IN ('completed', 'partial', 'failed'))
);
CREATE INDEX "analytics_rollup_runs_workspace_idx" ON "analytics_rollup_runs"("workspaceId", "provider", "granularity", "finishedAt" DESC);

ALTER TABLE "analytics_rollup_daily" ADD CONSTRAINT "analytics_rollup_daily_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_daily" ADD CONSTRAINT "analytics_rollup_daily_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_weekly" ADD CONSTRAINT "analytics_rollup_weekly_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_weekly" ADD CONSTRAINT "analytics_rollup_weekly_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_rollup_runs" ADD CONSTRAINT "analytics_rollup_runs_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_daily"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_weekly"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();
CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_runs"
  FOR EACH ROW EXECUTE FUNCTION rebuild_reject_purging_workspace_write();

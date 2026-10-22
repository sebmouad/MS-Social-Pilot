import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Lane 47: the squashed baseline migration equals the reviewed chain it
 * replaces. Each source block below is the exact bytes (SHA-256) of one
 * pre-squash migration.sql, in deploy ORDER. The squash itself was proven
 * equivalent by applying both the chain and the baseline to scratch
 * PostgreSQL databases and comparing full catalogs plus seed data
 * (see the lane-47 report; only CURRENT_TIMESTAMP apply-time stamps differ).
 * A guarded real-PostgreSQL apply of the baseline runs when
 * REBUILD_PREVIEW_DATABASE_URL is set.
 */
const BASELINE = '20261103000000_baseline';
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['20260810093237_init_postgres', '19c72b6f7a863000a85aead9763ecb3a10755e455223e952139f5b8055253b1e'],
  ['20260810142617_analytics_module', 'e7a2e72e7956758ab7cd28105b634dbdd621d431ea85254c78aad52d0c61deba'],
  ['20260810183448_tier2_tier3_edges', '6a975fe8177daebfe754c69b4a7bf8e0e63054eae7cc73e35e49cee646730085'],
  ['20260811003638_app_settings', 'f1dd0fe5ae74f99ec88a4baf767711d9e7484b33ad62c1829f1e1aeb907e5b14'],
  ['20260811074315_post_media_keys', 'f2d6c8c0eda32d0ed84085cbd4992513b3665ea7a0131f55d3f57fb7913753d9'],
  ['20260811220702_instagram_target', 'edee59e8d25a90cc2d2e645e042c7bd7fe12f29f47575fa57bf49d8fca57b792'],
  ['20260812070000_link_click_visitor_index', 'd760606cac0684708808e9a7d0723db7fd768147da191be1c82843cd790eec45'],
  ['20260812090000_target_reviews_backfilled', '3dc9c8a19d3278151b7f7b9670f594410f960062defe68524f821e1440f03db1'],
  ['20260812100000_target_block_reason', '6c20e84bf412c668bd1de90ef2487a0c88ccbc1b5bc30ef1cf27ccae9ab25e38'],
  ['20260812140000_worker_heartbeat', '7ca3c094849e70eb7516eef55b9c623d382e5598c529ae995d466196a3e4370c'],
  ['20260929090000_instance_owner_and_indexes', '94e8d81b1ac62feaf4ab10d967137bbf283a42a70178193e657730190d8f821d'],
  ['20261010090000_first_comment', '5229a7248fd2549d287250d876a7cb357b7f3fa9b2e59dd97c01d015ef01b335'],
  ['20261010120000_external_post_picture', '32f35e4e86cfe12c96604679fd6aab7294b59e3cf15dbb5f4754d8febc9d1b5e'],
  ['20261010140000_worker_runs_and_missing_posts', '6eb3ca53fc8cfcb6d03e5c563822f9601fcb4da3c2ffabbcb232772bc88777a3'],
  ['20261011090000_page_groups_labels_access', 'fdd9471fea3cfc86fde42236b792bea882ad2c409714d4053a6cda8198b3474d'],
  ['20261011150000_formats_snippets_sharing_reports', 'cb18371c7a709bfc5579ebb40cbb075229622868a6c1067939c6ebf8eb795c68'],
  ['20261012031949_worker_status_graph_usage', 'c13029e9966f7f865757101b7b3c6755dbbc75447a2c1f072e4a680fb3dcb562'],
  ['20261012032237_target_first_read', 'f9262ed3eb5788c3be7161f89ce52036330ff2c9de914fdc69c6a99490fd090a'],
  ['20261012034047_workspace_week_start', 'aba9becfbf0ec8eb034f87e2456f62ca087975a04e42accab652e8ea1ab6024e'],
  ['20261012034454_inbox_resolved', 'e7707529b2a3d3aa2350a308026fce08d32289e60875f9a28eb4b7c7b914024e'],
  ['20261012035406_notification_matrix', '1dbe137dab9477855357844e51e5194575c42cb33a7a3d94d1c693da96e5d8af'],
  ['20261012035930_report_ai_recap', '4889ce94473bb34d6cc1ba1f7d0867f8d3e52ec29cd6657afc6de445bbde347a'],
  ['20261012050005_queue_empty_notice', 'de2899a94a91f1551e593eabfd7ba7a719b94b8be0a1b95e2967b9564432bf9f'],
  ['20261012050443_draft_updated_notice', '51967d33df9e0842b09cacaece30699f38aeacd96f3af80054e72ad8e9693daf'],
  ['20261012052950_user_theme', '1830346f4ad5c713759d085e037d628f464086b44b47914b6aebf9bf74802895'],
  ['20261012054631_session_devices', '0e909694b59ab1308159285e3c5fe8130df00e68049b37feb384798df3bf728f'],
  ['20261012065921_feed_website_share', '40f31b52f976e3b3554a2e2d093f7a60b9e1ae0ec299ab0ead82572f98710e86'],
  ['20261012070327_spam_gap', '3e6b25754c2512e7976e17691179125d51faaf792e82ac0b4dfcecb4016f5c1a'],
  ['20261012082501_moderation_rules', 'ea6dc3bc3cf99441f400c7dc62c9890c9fcd0aef0c0cd0437795a7eb7b3c2eb3'],
  ['20261012083846_saved_replies', '8e12589b2aaff72134563784d9037a663af71df958a28e060d3bbc3b35532027'],
  ['20261012085109_caption_tests', '849572b34009052cbac20f46e5ac2cec00f46b84892bd13de28dc0cad4104a4b'],
  ['20261012090000_api_tokens_chat_channels_page_voice', '66da56a5563fa19b255202a514192e2fa6b7379e5cd9779b15aa2fa0cd1dedda'],
  ['20261012090622_best_time_mode', '687653e4f84d3596ea87d474e2c8b47f4e5dd99afd81051d0005155599e927e3'],
  ['20261012091935_audience', '13b7f3582855ce232cb4a86099022dc26d5c703797afeb998006e779d686838d'],
  ['20261012093838_ai_translate', '97003931814da94c446ca425f5b5e58ae2af55728b09380c3652635eb7228682'],
  ['20261012100746_short_link_target', 'a8b7c9a6bd92154a6af8be88f55d4b4d783575686787c22853e945e364b063a7'],
  ['20261012101604_uptime_days', '375eee2f5dda7e3a24ba14b190a7332c8cc4b6b30f06db059b9fd763ae473247'],
  ['20261012101918_error_events', '641e5782bb183ddb31b1995dd613a502469d3cb0c3e1631739e1fb7769111891'],
  ['20261012103124_workspace_exports', 'a2ccf6139ca2c68a9e85eaf6f1ef8a0a2c160c083dfc1c8b7df2ece7df881fc3'],
  ['20261012104601_media_variants_watermark', 'db6f3ff260656ec0fe4f3c1da64e651fa82c6a431fb32f4ccce6d0a4b8a567b6'],
  ['20261012105721_key_dates_seasons', '7d09cb1e5282a587b519a5e4e40b083e97ee6876ef857dd45d0d80cad53c30a9'],
  ['20261012120000_undo_send', '191f2533a0c6e34d681f6b2f013a8139c58678e4de8e1b1c95cce7d46c3361e2'],
  ['20261012130000_webhooks', '4a5b2154d4c79ecfbd2c6b8dfd24c78f70e3ced6a469b3366ab39d1c36e2e400'],
  ['20261012140000_content_mix', '30d189e80238ab1bad70372f3f63e772ee574174711760d03097110b77e4ea32'],
  ['20261012150000_other_networks', '1e322d71f230e921a47f3845753a11af5ed1e547ed9f8ec3badf480440f80b50'],
  ['20261012160000_post_templates', '5590d6d3075f32ed91004d65b5a24771d6cecfd768b0eb23b49bde85d7be708f'],
  ['20261012170000_post_target_removed_at', 'ae168effcaed45ecdffdec5286a02e6edd94c550e3d16d6c56e09c5d93be8114'],
  ['20261012180000_post_versions', '2850e64f3ffa97b0ed08f4d4e1be8776d2a5b5f207a6ad6a9e8f79ede95f11f0'],
  ['20261012200000_post_notes', '1c9b47fae3e6bfdcb7a99821cfe237611aea8e5eb4eddd429f075529fa694ead'],
  ['20261012220000_calendar_feeds', '8613b6e838e917be4a3f7af875bfdbb48a3eaf469b8ed4fed6567d26451b0770'],
  ['20261013090000_ai_generation_cost', 'ea3851f6f1126cc30f6c38a9d1052014741eed2990f5c3b8c4078e344dfedd51'],
  ['20261013090000_page_goals', '49f90e442521d25d031076b9f1b31a0b89147738bb276cc6d5c4ecc728231769'],
  ['20261013100000_root_section', '4c1e0bdb6645f3d5cbc03b381ff1f0910e74e87628bbde266b29708c12d2546d'],
  ['20261013110000_chart_notes', 'f6d642cfc6038e7e58c73e0198d39cbb92d636ddd038d2233b8364f64f2a6817'],
  ['20261013110000_two_step', 'e8f745ee1c178287e5191b322bd5f6d82b3f6c4c67c4302b97a233cb51ab2aae'],
  ['20261013120000_backup_runs', '56bca95fa60ab7c4bd36e559580386120bf950994ebff39d7d0fab8039d8484a'],
  ['20261013130000_inbox_response_time', '62addc197fb19cdd760abffce2681b74943233c6ba6374374b587d9efbb8f5e7'],
  ['20261013130000_system_alerts', 'fe8b414cc0eb47f4c8cf7b6f12bc61bdf6fc2014f9dcb0df8cfd69f6fcfa24f9'],
  ['20261013140000_client_invitations', '6bec812fdfb0b78c1bc0a35a02d26680f6125a025410138711141522338aea2d'],
  ['20261014090000_root_modules', '7ea057fcd4058f187013adb4d99809e20d72d6bfc4d637e44a875d17245e1c06'],
  ['20261015090000_pinned_metrics', 'ce17639305c003cb32f3811b810701bddf5c89abcfe7e7cc9b9ae7ce696f0895'],
  ['20261016090000_negative_comment_alert', 'a5dccf307e66cf884a6a15c648afcb732568eb3eb33a7b0ad4bace8432e953d5'],
  ['20261016100000_trending_topics', 'f32efebe21db9d3390d4d0f045ea1338c86d5d0154c9dd17cd2ea6622fd0cb92'],
  ['20261016110000_ai_alt_text', 'feae4148901564f2a1e2a2ef48d7d182b9e0ffd07a75d87007ffce48020d6de7'],
  ['20261016120000_email_tokens', 'ddac77d64019d0c0daeb85dc89d7442c00004957bb1ae6f4be5d787981d7b8d5'],
  ['20261017090000_developer_features', '5b4d4c087cff261ebf96f6f517eca6f3150ab58af1571418e6a6f34414081672'],
  ['20261017100000_viewer_role', 'a438f91ffa20f7d26eba8691107fe73926e4f00dbc580da0f019d3512fbe954b'],
  ['20261017110000_client_role', '826e1a7330a9f537b88eacd34f9b7e50548f1e75355bf9fc676621ca749d0527'],
  ['20261017120000_share_link_decides', 'ba3fbbc271d4c8a74f2f45ffef196b50c22c6e471f5aecffd18b81da5e6f18b4'],
  ['20261017130000_plans', 'cc4d9bb8cdf1b74929d56b7f8185683e2cbcc3f079ef1660005890c2997f244e'],
  ['20261018120000_telegram', '67ee49f9b302770454e0ff34ded8de424b71a29d7c725b3f8ad12892b4c2537a'],
  ['20261018130000_youtube', '44b1fabca320240db3942c94fa708be481212bbab856d3d23ab380228ca436ad'],
  ['20261018140000_tiktok', '39efb3bf02843273d367b88a528e12e2172024021327bcdff6ac2d304176405f'],
  ['20261019090000_saved_views', '8db9a5758c44c5b7170db32edcc3eb4293f2a3998f3007ce86bc8fa2bef43683'],
  ['20261019100000_inbox_assignee', '407392b0061fdef4a62510eda287de8960dc0f13abe895c82a200f2882b5866b'],
  ['20261019110000_post_target_message_override', '212ba08986a78b554e0ef657cce60730db5d8bf9f9ad67a4c1a8a9d14e78577f'],
  ['20261019120000_inbox_notes', '672b27a1ae6043bf86bb62cc08fbb225cfd2a1d00ee20a487b1a843d73bf48b7'],
  ['20261019130000_bio_page', '6ab8aa72a42bf30b70a1c4f68bab2cfa1f845025a8c74b5b3622317997abd93f'],
  ['20261019140000_ai_avoid_words', '5191c7dfb49f4994bf9e7c723f3cc0b1a24377ea4638d811d273a9796138472d'],
  ['20261019150000_tasks', 'b2454c2408fac409d84c1077656d90f3a84e245a91fcb899fa2682b213ac46e7'],
  ['20261019160000_post_target_skip_media', 'fd5ab020e603481229a052d599bb880c5bf38fa0f332e6e1783b092547ab8b47'],
  ['20261019170000_custom_fields', 'ffa0d1d6b7d0185dbdc183e46d587d698a3746613a8652c9dea8d949709c4360'],
  ['20261019180000_client_approval_step', '031284fc863689ab4807f14a9a94fa7523fdbe2d91edf0bac8cf70cc546d5fdd'],
  ['20261019190000_ai_image_kind', 'e5b188707c823e599c0473eb60f0ec0b6e8a9f38c63d2ffd6ba0ab20220bd710'],
  ['20261019200000_ai_agents', '8f40ca0748ad570c365bf3293a7c2ba463461dffee2cff928b86edd676001232'],
  ['20261020100000_post_place', 'dafea0f0feed49e2e09449b91199bf80e7e14b791f80a85b2ed8301c02eca5b9'],
  ['20261020110000_post_text_background', 'dd468df943f8948a083358afca1ccd124e1668bbc2ca3aca25346d727beaac84'],
  ['20261020120000_ai_videos', '09e34187895ee98a7e50457e89109661b9d47c2e3f06244fca2c0971b42570e9'],
  ['20261020130000_ai_voice_kind', '1aeca1314c51d71825dbd43f5f1f9da624d955be7361d6b92f77d0483bf26757'],
  ['20261021100000_oauth_connector', '40cb48ce755b3b64d5b45edee1164671e7b92cb3854eff94fc7bf4a62701fb7a'],
  ['20261022100000_changelog', '47ce1a91528bd9263f66252dcc43bc6c99ee82e7c99a6a5427dd598fcf3d5869'],
  ['20261022200000_root_admin_settings', 'd6f57204f010bff549284a785e77df3a98305c2fea1b07989dfda5fea6b07c75'],
  ['20261024100000_workspace_data_purges', '0f32e4ae733c07e8796babfa6e38ceddf0184fa240d1ae2e3d971643fc74a54e'],
  ['20261101120000_ads_object_inventory', 'a6ea92c28d7697c4d229c6c90e068cc6da6b1d5575864b43e1d0976a31b50861'],
  ['20261015120000_mcp_api_keys', '988d873c33229b439818d079d72c8bc49ffec93cbfe081ee4061ef93d2b2b3f4'],
  ['20261023100000_rebuild_worker_jobs', '5fb7962a2c720f8a3f30480c4c5afa6f0d48c92a8f2ee58047fb96ccf04a7205'],
  ['20261016190000_rebuild_inbox_deletions', '457327ad55d02af41eefe00f56021923abe5e13cf7ca668a96c064fa714acc57'],
  ['20261016220000_rebuild_post_deletions', '80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07'],
  ['20261017010000_rebuild_publication_attempts', '03973b6fb80dcf2580c5e39f0d2be8fd5715f47c1a953127ce939638bfece267'],
  ['20261017020000_rebuild_facebook_media_steps', '897464050aedf8c727fd695cc9b1fead0810d6c08606f3074c4d70529940a0e1'],
  ['20261017030000_rebuild_facebook_media_deletions', '3f5df63bf339fe532581f14738d089ca5f20a4c245f581f1587573b5bfe6cca5'],
  ['20261017040000_rebuild_facebook_media_resolution', '3227fbe5f381a25c87955ac809ef605fe1f2d51d9bb4f3ca4e5e9ce743c2a844'],
  ['20261018150000_rebuild_notifications', 'b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067'],
  ['20261018170000_rebuild_ads_operations', '61f575314590e45e8eafc7cb8088677fec2a78b39210b82187b6f2c05197d6d2'],
  ['20261018190000_rebuild_ads_creation', '749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0'],
  ['20261018193000_rebuild_purge_write_gates', '5250ec9a2e1176d59f8dd97b6b86d622187b87bd2d3944c41c7a411d157b51d6'],
  ['20261025100000_rebuild_task_comments', '648427469b965c3c5572b131c4834f772f1fdfe6884a0fd8c32aebc3588750ea'],
  ['20261018230000_rebuild_sharing_expiry', '28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263'],
  ['20261018233000_rebuild_mcp_resource_scope', '465a5d76679b45d7cb3fa6560b9d6a32501e56faab1922107547452a0b5519ab'],
  ['20261019010000_rebuild_report_runs', 'caa0c553569cf9f984e973ceb6e3ee858750209c6d2931e1316d3323b4357c4a'],
  ['20261019011000_rebuild_report_purge_gate', '122e813070361737ba1a89d775d2f92922dadd36423debb83411e0d5a4aa5d9e'],
  ['20261019020000_rebuild_destination_formats', '30325cdda1951cde93fab77a12bc349caa4422861fe133f68320ac3b979af6c6'],
  ['20261019030000_rebuild_facebook_native_journal', '3ef505dccb5156ea1d84472998d19fb8427b1232669f57ca98a8ac6cd1e04d46'],
  ['20261019040000_rebuild_facebook_native_status_proofs', '253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4'],
  ['20261019050000_rebuild_publication_submissions', '91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931'],
  ['20261019060000_rebuild_template_comment_delay', '4c2f5699a826b8008003718084ee13eb0e4ee37e8e861ffdaf4a8a0a292bcfc5'],
  ['20261026100000_rebuild_oauth_connectors', '58514dc2c438333ac8fb74d632254e230d1d8e69967cc61b2076676eba9879d5'],
  ['20261027100000_rebuild_workspace_exports', '1d154d62c8422a6f8ac99a92c2975da9e7d211dc018950cc4f3a411c4e96acac'],
  ['20261028100000_rebuild_alert_delivery', 'ed079e77ebb54ab01b46811686237c72308a11e43b75dfc9b9c9b0304801f36b'],
  ['20261029100000_rebuild_channel_profiles', 'eaad76b014a355047385425fee74caa5fd656c942f461016f98b96c32142f7f4'],
  ['20261030100000_rebuild_facebook_native_story_proofs', 'a74d6f4c546dd7f36f464636171bfe61d850dc42cca7786340c0169119fc680e'],
  ['20261030100000_rebuild_review_resolution', 'bf99bb579b7d989d3ec1ec2651d8db216cbcaa44d8fe7d0e10ccb1448e08e68e'],
  ['20261030110000_rebuild_ads_creative_creation', '2109fc4f75cf1f528a6940a14979b1a5b60e6b79f3d9f269dc19507001703aec'],
  ['20261030120000_rebuild_workspace_watermark', 'c950bc2f869e81840eb4dc9d06d5749559855ca40556b1e955203d5cfd6a30ce'],
  ['20261030130000_rebuild_comment_sentiment', 'a617901b60682c7200d5e8d561df615ac2302ef1fe0677fe246e7dba38b093e4'],
  ['20261030130000_rebuild_person_mcp_keys', 'ce14b0b7867c5a86a1c92290c173462964bd081213b90b037314f6dc64d789ff'],
  ['20261030140000_rebuild_facebook_native_schedule_changes', '08e1dd1d976c8dfc97207847a47fe8e671f2eeaf5987f9ab9272f9d00c17886e'],
  ['20261031100000_rebuild_destination_schedule_mode', '19fb66c945d4610accd4712bf769147409f5ba8a33632f360ec8c7d88671339b'],
  ['20261031120000_rebuild_facebook_sync_cursors', 'd7226dcf14f8c673e39de1d441e6f6bb1271d993c4bec263f20aabe12e24028e'],
  ['20261031140000_rebuild_wordpress_sources', 'cce64edcfbcf19553f7eafe661f86fb067d8d0152e08712d05dc1745121c4642'],
  ['20261022180000_rebuild_uptime_samples', '20fe4458ee87befda8eec716968b3c7717e44fe94619f19bfb7170c01c9fab11'],
  ['20261022190000_rebuild_chat_deliveries', '758df8d7f9d3716776bb501a54c2a5ab41e365ed5ef210429e8e87bbe60b41cf'],
  ['20261031150000_rebuild_supplementary_purge_gates', 'f3f22b82d60a3bbbbacd5b152b3ceb577a3d39d126fd0ecdc09151e106f09768'],
  ['20261031160000_rebuild_read_path_indexes', 'afada5e8886f5b725e5ba1907315048ccb11b6d9c300939d649220c9b9638762'],
  ['20261031170000_rebuild_inbox_metadata', '0f64264b7fbdb9108ffd77fd4dff7b8a233d6c227ec6a57652b9f88c8f63f870'],
  ['20261031170000_rebuild_search_trigrams', '2a5c27ac493fedbed7174ebb1c2bab19d0f33f220a341cb23b271f42e5cf572e'],
  ['20261031180000_rebuild_ads_ad_creation', '1769fa24129e6d74119e84d0677a2baf0c935cb73a4e722ae0a443b7fbc7120f'],
  ['20261101100000_rebuild_writing_agents', 'e70e49f442d3fadde389b6f6990898ab60e157d1617da55080a06dee3c18525e'],
  ['20261101100100_rebuild_post_exports', 'e5f8825c4bbe5e153da3a56bd18fd3d6668d0ea2765930f9a20afd396d9ce53c'],
  ['20261102120000_rebuild_inbox_note_mentions', '59d5aed5183c5bb7a59832abf7692d85a1259b9d14ee0c891fb02a8c441fe817'],
];
const EXPECTED_TABLES: ReadonlyArray<string> = [
  'OAuthClient',
  'OAuthCode',
  'activity_logs',
  'ad_accounts',
  'ad_insights',
  'ads_management_operations',
  'ads_objects',
  'ai_agents',
  'ai_generations',
  'ai_videos',
  'api_tokens',
  'app_settings',
  'backup_runs',
  'bio_links',
  'bio_pages',
  'calendar_feeds',
  'caption_tests',
  'changelog_entries',
  'chart_notes',
  'chat_channels',
  'client_invitations',
  'content_mix_rules',
  'conversation_messages',
  'conversations',
  'custom_fields',
  'email_logs',
  'email_tokens',
  'error_events',
  'external_posts',
  'feed_items',
  'feed_sources',
  'graph_usage',
  'holiday_years',
  'inbox_notes',
  'instagram_accounts',
  'instagram_insights',
  'instagram_media',
  'invitations',
  'key_dates',
  'labels',
  'link_clicks',
  'mcp_api_keys',
  'mcp_oauth_clients',
  'mcp_oauth_codes',
  'media',
  'member_page_access',
  'memberships',
  'metric_availability',
  'moderation_actions',
  'moderation_rules',
  'notification_mutes',
  'notification_settings',
  'page_goals',
  'page_group_targets',
  'page_groups',
  'page_insights',
  'page_reviews',
  'page_videos',
  'passkeys',
  'person_mcp_keys',
  'plans',
  'post_comments',
  'post_field_values',
  'post_labels',
  'post_notes',
  'post_targets',
  'post_templates',
  'post_versions',
  'posts',
  'public_holidays',
  'queue_slots',
  'rebuild_channel_profiles',
  'rebuild_chat_deliveries',
  'rebuild_export_file_cleanups',
  'rebuild_facebook_media_deletions',
  'rebuild_facebook_media_resolutions',
  'rebuild_facebook_media_steps',
  'rebuild_facebook_native_journal',
  'rebuild_facebook_native_schedule_changes',
  'rebuild_facebook_native_status_proofs',
  'rebuild_facebook_sync_cursors',
  'rebuild_inbox_deletions',
  'rebuild_job_leases',
  'rebuild_monitoring_deliveries',
  'rebuild_notifications',
  'rebuild_post_deletions',
  'rebuild_post_export_runs',
  'rebuild_post_exports',
  'rebuild_publication_attempts',
  'rebuild_sync_runs',
  'rebuild_uptime_samples',
  'rebuild_workspace_exports',
  'rebuild_workspace_watermarks',
  'rebuild_writing_agent_runs',
  'rebuild_writing_agents',
  'recovery_codes',
  'report_runs',
  'report_schedules',
  'report_templates',
  'review_decisions',
  'root_activities',
  'saved_replies',
  'saved_views',
  'seasonal_modes',
  'sessions',
  'share_links',
  'short_links',
  'snippets',
  'social_accounts',
  'system_alerts',
  'targets',
  'task_comments',
  'tasks',
  'trending_topics',
  'trusted_devices',
  'uptime_days',
  'users',
  'webhook_deliveries',
  'webhook_endpoints',
  'wordpress_recipe_plans',
  'wordpress_recipe_sources',
  'worker_heartbeats',
  'worker_job_runs',
  'workspace_data_purges',
  'workspace_exports',
  'workspaces',
];

const baseline = readFileSync(`prisma/migrations/${BASELINE}/migration.sql`, 'utf8');

describe('baseline migration', () => {
  it('is the only migration in the directory', () => {
    const entries = readdirSync('prisma/migrations').filter(e => e !== 'migration_lock.toml');
    expect(entries).toEqual([BASELINE]);
  });

  it('contains every reviewed source block verbatim, in deploy order', () => {
    const marker = /^-- ===== source (\d+)\/(\d+): (\S+) \(sha256:([a-f0-9]{64})\) =====$/gm;
    const marks = [...baseline.matchAll(marker)];
    expect(marks).toHaveLength(SOURCES.length);
    expect(marks[0][2]).toBe(String(SOURCES.length));
    const blocks: string[] = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index! + marks[i][0].length + 1;
      const end = i + 1 < marks.length ? marks[i + 1].index! - 1 : baseline.length;
      blocks.push(baseline.slice(start, end));
    }
    SOURCES.forEach(([name, sha], i) => {
      expect(marks[i][1]).toBe(String(i + 1).padStart(3, '0'));
      expect(marks[i][3]).toBe(name);
      expect(marks[i][4]).toBe(sha);
      expect(createHash('sha256').update(blocks[i]).digest('hex')).toBe(sha);
    });
  });

  it('creates exactly the reviewed table inventory and drops nothing', () => {
    const found = new Set<string>();
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([\w]+)"?\.)?"?([\w]+)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(baseline))) {
      const t = m[2] || m[1];
      if (t.toLowerCase() !== 'public') found.add(t);
    }
    expect([...found].sort()).toEqual([...EXPECTED_TABLES]);
    expect(baseline).not.toMatch(/^\s*DROP\s+TABLE/im);
  });

  it('carries the chat-deliveries outbox with its tenant binding and purge gate', () => {
    expect(baseline).toContain('CREATE TABLE rebuild_chat_deliveries (');
    expect(baseline).toContain('FOREIGN KEY ("channelId", "workspaceId") REFERENCES chat_channels(id, "workspaceId") ON DELETE CASCADE');
    expect(baseline).toContain('BEFORE INSERT OR UPDATE ON public.rebuild_chat_deliveries');
    expect(baseline).toContain('public.rebuild_reject_purging_workspace_write()');
  });

  it('warns that it must not run inside a single transaction', () => {
    expect(baseline).toContain('ALTER TYPE ... ADD VALUE');
    expect(baseline).toMatch(/WITHOUT a wrapping transaction/);
  });
});

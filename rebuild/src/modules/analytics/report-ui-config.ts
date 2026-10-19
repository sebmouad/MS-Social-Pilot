import { z } from 'zod';
import { cron, entry } from '@/lib/config/entry';
import { REPORT_FREQUENCIES, REPORT_RANGE_KEYS, REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS } from './reports/contracts';

const label = z.string().trim().min(1).max(160);
const unique = (items: ReadonlyArray<{id:string}>) => new Set(items.map(item=>item.id)).size===items.length;
const rawSchema = z.object({
  sectionLabels:z.array(z.object({id:z.enum(REPORT_SECTION_IDS),label}).strict()).min(1).max(REPORT_SECTION_IDS.length).refine(unique),
  enabledSections:z.array(z.enum(REPORT_SUPPORTED_SECTIONS)).min(1).max(REPORT_SUPPORTED_SECTIONS.length).refine(items=>new Set(items).size===items.length),
  rangeOptions:z.array(z.object({id:z.enum(REPORT_RANGE_KEYS),label}).strict()).min(1).max(REPORT_RANGE_KEYS.length).refine(unique),
  frequencyOptions:z.array(z.object({id:z.enum(REPORT_FREQUENCIES),label}).strict()).min(1).max(REPORT_FREQUENCIES.length).refine(unique),
  defaultSections:z.array(z.enum(REPORT_SUPPORTED_SECTIONS)).min(1).max(REPORT_SUPPORTED_SECTIONS.length).refine(items=>new Set(items).size===items.length),
  defaultRange:z.enum(REPORT_RANGE_KEYS), defaultFrequency:z.enum(REPORT_FREQUENCIES),
}).strict().superRefine((policy,context)=>{
  if(REPORT_SECTION_IDS.some(id=>!policy.sectionLabels.some(item=>item.id===id))) context.addIssue({code:'custom',path:['sectionLabels'],message:'Name every stored report section.'});
  if(!policy.rangeOptions.some(item=>item.id===policy.defaultRange)) context.addIssue({code:'custom',path:['defaultRange'],message:'Choose an offered default period.'});
  if(!policy.frequencyOptions.some(item=>item.id===policy.defaultFrequency)) context.addIssue({code:'custom',path:['defaultFrequency'],message:'Choose an offered default frequency.'});
  if(policy.defaultSections.some(id=>!policy.enabledSections.includes(id))) context.addIssue({code:'custom',path:['defaultSections'],message:'Default sections must be offered.'});
});
export const REPORT_UI_POLICY_SCHEMA = rawSchema.transform(policy=>({...policy,sectionOptions:policy.enabledSections.map(id=>({id,label:policy.sectionLabels.find(item=>item.id===id)!.label}))}));
export type ReportUiPolicy = z.infer<typeof REPORT_UI_POLICY_SCHEMA>;
export const DEFAULT_REPORT_UI_POLICY = {
  sectionLabels:[{id:'analysis',label:'Analysis'},{id:'goals',label:'Goals'},{id:'responseTime',label:'Response time'},{id:'audience',label:'Audience'},{id:'published',label:'Published posts'},{id:'destinations',label:'Destinations'},{id:'topPosts',label:'Top posts'}],
  enabledSections:['analysis','goals','responseTime','audience','published','destinations','topPosts'],
  rangeOptions:[{id:'today',label:'Today'},{id:'yesterday',label:'Yesterday'},{id:'7d',label:'Last 7 days'},{id:'30d',label:'Last 30 days'},{id:'90d',label:'Last 90 days'},{id:'thisMonth',label:'This month'},{id:'lastMonth',label:'Last month'},{id:'thisYear',label:'This year'},{id:'all',label:'All time'}],
  frequencyOptions:[{id:'weekly',label:'Weekly'},{id:'monthly',label:'Monthly'}],
  defaultSections:['analysis','audience','published'],defaultRange:'30d',defaultFrequency:'weekly',
};
export const REPORT_UI_CONFIG = [entry({key:'analytics.reports.ui',group:'Analytics · Report workflows',label:'Report choices and labels',kind:'json',description:'Names and offered choices for report sections, periods and frequencies, plus defaults. Cannot enable an unimplemented report section.',defaultValue:DEFAULT_REPORT_UI_POLICY,schema:rawSchema,consumption:'active'})] as const;

export const REPORT_HOST_CONFIG = [
  entry({key:'analytics.reports.requestMaxBytes',group:'Analytics · Report workflows',label:'Report request size (bytes)',kind:'number',description:'Actual streamed JSON byte limit for report definition and preparation requests.',defaultValue:65536,schema:z.number().int().min(4096).max(1048576),consumption:'active'}),
  entry({key:'analytics.reports.deliveryEnabled',group:'Analytics · Report workflows',label:'Allow scheduled report delivery',kind:'boolean',description:'Allow delivery through the current mail transport while background jobs are enabled. Existing history and local generation remain available when off.',defaultValue:false,schema:z.boolean(),consumption:'active'}),
  entry({key:'analytics.reports.schedule',group:'Analytics · Report workflows',label:'Report schedule polling',kind:'text',description:'Five-field cron for the Reports job, in the server timezone. Due times retain workspace timezone semantics.',defaultValue:'*/5 * * * *',schema:cron,consumption:'active'}),
] as const;

// Values remain IANA identifiers for Supabase; labels are written for students.
const labels={
  'Europe/London':'United Kingdom — London (GMT / BST)',
  'Europe/Vienna':'Austria — Vienna',
  'Europe/Dublin':'Ireland — Dublin',
  'UTC':'Coordinated Universal Time (UTC)'
};
const fallback=['Europe/London','Europe/Vienna','Europe/Dublin','Europe/Paris','Europe/Berlin',
  'Europe/Madrid','Europe/Rome','Europe/Athens','America/New_York','America/Chicago',
  'America/Denver','America/Los_Angeles','America/Toronto','Asia/Dubai','Asia/Kolkata',
  'Asia/Singapore','Asia/Hong_Kong','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];

export function timezoneLabel(zone) {
  if(labels[zone])return labels[zone];
  const parts=zone.split('/');
  return parts.length>1?`${parts.at(-1).replaceAll('_',' ')} — ${parts.slice(0,-1).join(' / ').replaceAll('_',' ')}`:zone;
}

export function timezoneGroups(selected,detected) {
  let available=fallback;
  try {available=Intl.supportedValuesOf?.('timeZone')||fallback;}catch {/* Older browsers use the curated list. */}
  const recommended=[...new Set(['Europe/London',detected,'UTC'].filter(Boolean))];
  const other=[...new Set([...available,selected].filter(Boolean))].filter(zone=>!recommended.includes(zone))
    .sort((a,b)=>timezoneLabel(a).localeCompare(timezoneLabel(b)));
  const option=zone=>({value:zone,label:timezoneLabel(zone)+(zone===detected?' · device timezone':'')});
  return [
    {label:'Suggested timezones',options:recommended.map(option)},
    {label:'Other timezones',options:other.map(option)}
  ];
}

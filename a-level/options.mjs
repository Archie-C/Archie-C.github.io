export function optionRequirement(group){
  if(group.min_choices===group.max_choices)return `Choose exactly ${group.min_choices}`;
  if(group.min_choices===0)return `Choose up to ${group.max_choices}`;
  return `Choose ${group.min_choices}–${group.max_choices}`;
}

export function validateOptionSelection(data,specifications,ids){
  if(!specifications.length)return 'Select at least one subject.';
  const chosen=new Set(ids);
  for(const group of data.option_groups||[]){
    if(group.archived||!specifications.includes(group.specification_id))continue;
    const count=(data.options||[]).filter(o=>o.group_id===group.id&&!o.archived&&chosen.has(o.id)).length;
    if(count<group.min_choices||count>group.max_choices)return `${group.title}: ${optionRequirement(group).toLowerCase()} (selected ${count}).`;
  }
  for(const option of data.options||[]){
    if(chosen.has(option.id)&&option.requires_option_id&&!chosen.has(option.requires_option_id)){
      const required=data.options.find(o=>o.id===option.requires_option_id);
      return `${option.title} requires ${required?.title||option.requires_option_id}.`;
    }
  }
  return null;
}

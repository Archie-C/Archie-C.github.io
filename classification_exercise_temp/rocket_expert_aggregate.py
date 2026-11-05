"""Combine diagnostic and frozen feasibility evidence without mixing their rates."""
import argparse
from collections import Counter
from dataclasses import asdict
import gzip
import hashlib
import json
from pathlib import Path

from rocket_expert_benchmark import (FINAL_SET, FINAL_SUCCESS_TARGET, SCENARIO_SET,
                                     diagnostic_cases, final_feasibility_cases)
from rocket_scoring import aggregate


def summarize_reports(diagnostic, feasibility):
    """Validate complete controller reports and keep metrics per scenario set."""
    result = dict(schema='rocket-controller-comparison-v1.0', scoring='touchdown-v1.0',
                  final_success_target=FINAL_SUCCESS_TARGET, sets={})
    provenance = {}
    for set_name, report, cases, version in (
            ('diagnostic', diagnostic, diagnostic_cases(), SCENARIO_SET),
            ('feasibility', feasibility, final_feasibility_cases(), FINAL_SET)):
        if set_name == 'feasibility' and (report.get('evaluated_set') != 'final' or report.get('final_set') != version):
            raise ValueError('incompatible final feasibility report')
        entry = dict(scenario_set=version, policies={}, cases=[])
        runs_by_policy = {}
        for name in ('continuous_reference', 'discrete_expert'):
            policy = report['policies'][name]
            runs = policy['runs']
            if len(runs) != len(cases):
                raise ValueError('a scenario set is incomplete')
            for case, run in zip(cases, runs):
                replay = run['replay']
                if (run['case_id'] != case['case_id'] or run['scenario'] != case['scenario'] or
                        run['initial'] != asdict(case['initial']) or
                        run['result'] != replay['terminal']['scoring'] or
                        replay['config']['scoring']['version'] != 'touchdown-v1.0'):
                    raise ValueError('case identity or authoritative score differs')
                source = replay['config']['closed_loop']['policy']
                identity = (source['version'], source['source_sha256'])
                if name in provenance and provenance[name] != identity:
                    raise ValueError('controller version differs between cases or sets')
                provenance[name] = identity
            if policy['metrics'] != aggregate([run['result'] for run in runs]):
                raise ValueError('aggregate differs from individual scores')
            reasons = Counter(reason for run in runs for reason in run['result']['reasons'])
            if policy['failure_reasons'] != dict(sorted(reasons.items())):
                raise ValueError('failure reasons differ from individual scores')
            decisions = [d for run in runs for d in run['replay']['decisions']]
            fallback_count = sum(bool((d['diagnostics'] or {}).get('fallback')) for d in decisions)
            frequency = fallback_count / len(decisions) if decisions else 0.
            if (policy['fallback_count'] != fallback_count or policy['decisions'] != len(decisions) or
                    policy['fallback_frequency'] != frequency):
                raise ValueError('fallback or decision count differs from replay')
            entry['policies'][name] = {key: policy[key] for key in
                                       ('metrics', 'failure_reasons', 'decisions', 'fallback_count',
                                        'fallback_frequency', 'mean_wall_seconds_per_decision')}
            entry['policies'][name]['version'], entry['policies'][name]['source_sha256'] = provenance[name]
            runs_by_policy[name] = runs
        for index, case in enumerate(cases):
            continuous = runs_by_policy['continuous_reference'][index]['result']
            discrete = runs_by_policy['discrete_expert'][index]['result']
            status = ('discrete success' if discrete['success'] else
                      'continuous candidate only' if continuous['success'] else 'failure or undetermined')
            entry['cases'].append(dict(case_id=case['case_id'], scenario=case['scenario'], status=status,
                                       continuous_result=continuous, discrete_result=discrete))
        result['sets'][set_name] = entry
    result['final_target_met'] = result['sets']['feasibility']['policies']['discrete_expert']['metrics']['success_rate'] >= FINAL_SUCCESS_TARGET
    return result


def _read(path):
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as source:
        return json.load(source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('diagnostic_report'); parser.add_argument('final_report'); parser.add_argument('output')
    args = parser.parse_args()
    summary = summarize_reports(_read(args.diagnostic_report), _read(args.final_report))
    summary['source_archives'] = {Path(path).name: hashlib.sha256(Path(path).read_bytes()).hexdigest()
                                  for path in (args.diagnostic_report, args.final_report)}
    Path(args.output).write_text(json.dumps(summary, indent=2, allow_nan=False)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()

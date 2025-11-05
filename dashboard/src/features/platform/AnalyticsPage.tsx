import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardTimeRange } from '@heyloo/shared';
import { GaugeCircle, Headphones, Timer, Users } from 'lucide-react';

import {
  fetchCallCenterMetrics,
  fetchUsageTimeline
} from '../../api/platform';
import { MetricCard } from '../../components/MetricCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';

const ranges: DashboardTimeRange[] = ['today', 'last7', 'last30', 'month_to_date'];

export function PlatformAnalyticsPage() {
  const [range, setRange] = useState<DashboardTimeRange>('last7');

  const timelineQuery = useQuery({
    queryKey: ['platform-usage-timeline', range],
    queryFn: () => fetchUsageTimeline(range)
  });

  const callMetricsQuery = useQuery({
    queryKey: ['platform-call-metrics', range],
    queryFn: () => fetchCallCenterMetrics(range)
  });

  const chartData =
    timelineQuery.data?.map((row) => ({
      label: row.date,
      value: row.totalCalls
    })) ?? [];

  const callMetrics = callMetricsQuery.data;

  return (
    <div className="space-y-10 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Operational Analytics</p>
          <h1 className="text-4xl font-bold">Voice AI Call Center Pulse</h1>
        </div>
        <div className="flex gap-2 bg-white/10 rounded-full p-1 border border-white/10">
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                range === option
                  ? 'bg-white text-slate-900 shadow-lg'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {option.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="Total Calls"
          value={callMetrics ? callMetrics.totalCalls.toLocaleString() : '—'}
          icon={<Headphones className="h-5 w-5" />}
          accent="sky"
        />
        <MetricCard
          label="Average Handle Time"
          value={callMetrics ? `${callMetrics.averageHandleTime} sec` : '—'}
          icon={<Timer className="h-5 w-5" />}
          accent="indigo"
        />
        <MetricCard
          label="First Call Resolution"
          value={callMetrics ? `${callMetrics.firstCallResolution}%` : '—'}
          icon={<GaugeCircle className="h-5 w-5" />}
          accent="emerald"
        />
        <MetricCard
          label="Service Level"
          value={callMetrics ? `${callMetrics.serviceLevel}%` : '—'}
          icon={<Users className="h-5 w-5" />}
          accent="amber"
          delta={callMetrics ? `Abandonment ${callMetrics.callAbandonmentRate}%` : undefined}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white/70">Call Volume Velocity</h2>
        <TrendAreaChart data={chartData} color="#38bdf8" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="glass-panel border border-white/10 p-6 space-y-4">
          <h3 className="text-white/70 font-semibold">Quality Benchmarks</h3>
          <ul className="space-y-3 text-sm text-white/70">
            <li className="flex justify-between">
              <span>Call abandonment</span>
              <span>{callMetrics ? `${callMetrics.callAbandonmentRate}%` : '—'}</span>
            </li>
            <li className="flex justify-between">
              <span>Repeat call rate</span>
              <span>{callMetrics ? `${callMetrics.repeatCallRate}%` : '—'}</span>
            </li>
            <li className="flex justify-between">
              <span>Average wait</span>
              <span>0 sec (AI instant answer)</span>
            </li>
          </ul>
        </div>
        <div className="glass-panel border border-white/10 p-6 space-y-4">
          <h3 className="text-white/70 font-semibold">Insights</h3>
          <p className="text-white/70 text-sm leading-relaxed">
            Monitor how voice AI performance maps to orders across the platform. Pair call volume
            spikes with restaurant staffing and promotional campaigns. Use the service level to
            benchmark customer experience and trigger proactive outreach when trends slip.
          </p>
        </div>
      </section>
    </div>
  );
}

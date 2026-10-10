import { Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui'
import NetWorthTab from './reports/NetWorthTab'
import CashFlowTab from './reports/CashFlowTab'
import SpendingTab from './reports/SpendingTab'
import SpendingTrendsTab from './reports/SpendingTrendsTab'
import EmergencyFundTab from './reports/EmergencyFundTab'

type ReportTab = 'spending' | 'spending-trends' | 'net-worth' | 'cash-flow' | 'emergency-fund'

const REPORT_TITLES: Record<ReportTab, string> = {
  'net-worth': 'Net Worth & Equity',
  'cash-flow': 'Cash Flow',
  'spending': 'Spending',
  'spending-trends': 'Spending Trends',
  'emergency-fund': 'Emergency Fund',
}

export default function ReportsPage() {
  const { reportTab } = useParams<{ reportTab: string }>()
  const activeTab = (reportTab ?? 'net-worth') as ReportTab

  // Subscriptions used to live here as /reports/subscriptions; any stale link
  // to it (or to any other unknown tab) would otherwise render a bare header.
  if (!(activeTab in REPORT_TITLES)) return <Navigate to="/" replace />

  const title = REPORT_TITLES[activeTab]

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader title={title} />
      {/* Each tab is its own component, so only the active tab's report
          queries mount — switching tabs is what triggers the fetch, not
          loading the page. */}
      {activeTab === 'net-worth' && <NetWorthTab />}
      {activeTab === 'cash-flow' && <CashFlowTab />}
      {activeTab === 'spending' && <SpendingTab />}
      {activeTab === 'spending-trends' && <SpendingTrendsTab />}
      {activeTab === 'emergency-fund' && <EmergencyFundTab />}
    </div>
  )
}

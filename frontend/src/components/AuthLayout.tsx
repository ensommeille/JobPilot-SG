import type { ReactNode } from 'react'

// 登录 / 注册共用的左右分栏布局：左侧品牌介绍，右侧表单
const AuthLayout = ({ children }: { children: ReactNode }) => (
  <div className="auth-page">
    <aside className="auth-aside">
      <div className="row" style={{ fontWeight: 700, fontSize: 17 }}>
        <span className="brand-mark" style={{ background: 'rgba(255,255,255,.18)' }}>JP</span>
        JobPilot SG
      </div>

      <div>
        <h2>Every Singapore job, one profile, zero repeated forms.</h2>
        <p>Search InternSG and more in one place, then let the AI assistant draft your applications — you review and submit.</p>
        <ul className="auth-points">
          <li><span>✓</span>Aggregated, de-duplicated job listings</li>
          <li><span>✓</span>One profile mapped to every application form</li>
          <li><span>✓</span>AI suggests, you always confirm</li>
        </ul>
      </div>

      <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', margin: 0 }}>
        NUS SWE5006 · Team JobPilot
      </p>
    </aside>

    <main className="auth-main">{children}</main>
  </div>
)

export default AuthLayout

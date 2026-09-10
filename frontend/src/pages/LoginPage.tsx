const LoginPage = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '100px' }}>
      <h1>JobPilot SG</h1>
      <h2>Login</h2>
      <input type="email" placeholder="Email" style={{ margin: '8px', padding: '8px', width: '300px' }} />
      <input type="password" placeholder="Password" style={{ margin: '8px', padding: '8px', width: '300px' }} />
      <button style={{ margin: '8px', padding: '10px 40px' }}>Login</button>
    </div>
  )
}

export default LoginPage
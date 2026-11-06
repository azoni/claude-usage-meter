#!/usr/bin/env node
// Stands in for the claude binary in meter tests. FAKE_CLAUDE picks how it
// answers the get_usage request it reads on stdin.
const mode = process.env.FAKE_CLAUDE ?? 'success'

process.stdin.once('data', chunk => {
  const { request_id } = JSON.parse(String(chunk).split('\n')[0])

  if (mode === 'silent') {
    return
  }
  if (mode === 'exit') {
    process.exit(3)
  }

  console.log(JSON.stringify({ type: 'system', subtype: 'hook_started' }))
  console.log('not json')

  if (mode === 'args') {
    const response = { argv: process.argv.slice(2), cwd: process.cwd(), configDir: process.env.CLAUDE_CONFIG_DIR }
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id, response } }))
  } else if (mode === 'error') {
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id, error: 'get_usage is not supported in this context' } }))
  } else {
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'someone-else', response: {} } }))
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id, response: { rate_limits: { limits: [{ kind: 'session', percent: 24, resets_at: '2026-11-03T22:09:59.719085+00:00' }] } } } }))
  }
})

// Like the real binary, stay up until stdin closes.
process.stdin.resume()

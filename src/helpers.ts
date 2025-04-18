function isSpamFn(re: string): (input: string | undefined | null) => boolean {
  return (input) => {
    if (input === '' || input === null || input === undefined) {
      return false
    }
    return input.match(new RegExp(re)) !== null
  }
}

function unixEpoch(): number {
  return +new Date() / 1000
}

function unixToTimezone(timestamp: number, timezone: string): string {
  const date = new Date(timestamp * 1000)
  const formatter = new Intl.DateTimeFormat('en-HK', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date)
}

const nargs = /\{([0-9a-zA-Z_]+)}/g

function template(string: string, binding: Record<string, any>): string {
  return string.replace(nargs, (match, i, index) => {
    if (string[index - 1] === '{' && string[index + match.length] === '}') {
      return i
    } else {
      return binding[i] ?? ''
    }
  })
}

export { unixToTimezone, isSpamFn, unixEpoch, template }

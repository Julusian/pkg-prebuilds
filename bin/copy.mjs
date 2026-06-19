#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'
import { parseArgs } from 'node:util'
import { getPrebuildName } from '../lib/prebuild.js'
import cp from 'child_process'

/**
 * Rename a binding file and move to the prebuilds folder, named according to the supplied parameters.
 */

const require = createRequire(import.meta.url)
const version = require('../package').version

const optionDefinitions = {
	baseDir: { demand: true, describe: 'base path to built binary files', type: 'string' },
	source: { demand: true, describe: 'filename of built binary file', type: 'string' },
	name: { demand: true, describe: 'name of the module', type: 'string' },
	strip: { demand: false, describe: 'strip file of debug symbols', type: 'boolean' },
	libc: { demand: false, describe: 'libc environment', type: 'string' },
	napi_version: { demand: true, describe: 'node-api version', type: 'string' },
	runtime: { demand: false, describe: 'runtime', type: 'string' },
	arch: { demand: false, describe: 'override the architecture', type: 'string' },
	platform: { demand: false, describe: 'override the platform', type: 'string' },
	extraFiles: { demand: false, describe: 'extra files to copy', type: 'string', multiple: true },
}

function printUsage() {
	console.log('pkg-prebuilds ' + version + '\n\nUsage: pkg-prebuilds-copy [options]\n\nOptions:')
	for (const [key, def] of Object.entries(optionDefinitions)) {
		const required = def.demand ? ' (required)' : ''
		console.log(`  --${key}\t${def.describe}${required}`)
	}
	console.log('  --version\tShow version number')
	console.log('  --help\tShow help')
}

// Handle --version and --help before parsing, to mirror the previous yargs behaviour
const rawArgs = process.argv.slice(2)
if (rawArgs.includes('--version')) {
	console.log(version)
	process.exit(0)
}
if (rawArgs.includes('--help')) {
	printUsage()
	process.exit(0)
}

// Build the option map for parseArgs from the definitions above
const parseArgsOptions = {}
for (const [key, def] of Object.entries(optionDefinitions)) {
	parseArgsOptions[key] = { type: def.type }
	if (def.multiple) parseArgsOptions[key].multiple = true
}

let argv
try {
	argv = parseArgs({ args: rawArgs, options: parseArgsOptions, strict: false, allowPositionals: true }).values
} catch (e) {
	console.error(`Failed to parse arguments: ${e.message}`)
	process.exit(1)
}

// Validate required options (parseArgs has no equivalent of yargs' `demand`)
const missing = Object.entries(optionDefinitions)
	.filter(([key, def]) => def.demand && argv[key] === undefined)
	.map(([key]) => key)
if (missing.length > 0) {
	console.error(`Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.map((k) => '--' + k).join(', ')}`)
	process.exit(1)
}

const targetDir = path.join(process.cwd(), 'prebuilds')
const sourceDir = path.join(process.cwd(), argv.baseDir)
const sourceFile = path.join(sourceDir, argv.source)

if (!fs.existsSync(sourceFile)) {
	console.error(`Built binary does not exist!`)
	process.exit(1)
}

let libc = argv.libc
if (libc === 'glibc') libc = null

// Determine the target filename
const prebuildName = getPrebuildName({
	arch: argv.arch || os.arch(),
	platform: argv.platform || os.platform(),
	name: argv.name,
	libc: libc,
	napi_version: argv.napi_version,
	runtime: argv.runtime || 'node',
})

const destFile = path.join(targetDir, prebuildName)
const destDir = path.dirname(destFile)

// Make sure the directory exists
if (!fs.existsSync(destDir)) {
	fs.mkdirSync(destDir, { recursive: true })
}

// Copy the bindings file
fs.copyFileSync(sourceFile, destFile)

if (argv.strip) {
	if (os.platform() === 'linux') {
		cp.spawnSync('strip', [destFile, '--strip-all'])
	} else if (os.platform() === 'darwin') {
		cp.spawnSync('strip', [destFile, '-Sx'])
	}
}

// copy any extra files that have been requested, typically libraries needed
if (argv.extraFiles) {
	const extraFiles = Array.isArray(argv.extraFiles) ? argv.extraFiles : [argv.extraFiles]

	for (const file of extraFiles) {
		fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file))
	}
}

console.log('Done')

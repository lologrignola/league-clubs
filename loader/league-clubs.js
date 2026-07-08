/**
 * @name Pengu Clubs
 * @author lologrignola
 * @description In-client clubs chat — loads plugin code from GitHub via jsDelivr
 * @link https://github.com/lologrignola/league-clubs
 *
 * Install: copy this file into your Pengu plugins folder (same place as Relay.js).
 * Updates: push to GitHub; clients pick up changes after jsDelivr cache (~few min).
 * Pin a release: change @main to @v1.0.0 below.
 */

const CDN = 'https://cdn.jsdelivr.net/gh/lologrignola/league-clubs@main/index.js'

import(CDN).catch((err) => {
  console.error('[pengu-clubs] CDN preload failed — check repo is public and pushed:', err)
})

export { init, load } from 'https://cdn.jsdelivr.net/gh/lologrignola/league-clubs@main/index.js'

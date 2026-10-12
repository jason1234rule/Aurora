<template>
  <div class="settings-view p-6 max-w-2xl mx-auto">
    <h1 class="text-3xl font-bold text-white mb-6">Settings</h1>

    <!-- ── Tab bar ────────────────────────────────────────────────── -->
    <nav v-if="!isSearching" class="flex items-center justify-center gap-1 mb-2 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-x-auto no-scrollbar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="relative px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200"
        :class="activeTab === tab.id
          ? 'bg-accent/15 text-accent shadow-sm'
          : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- ── Search input ───────────────────────────────────────────── -->
    <div class="relative mb-6">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>
      <input
        v-model="settingsSearch"
        type="text"
        placeholder="Search settings…"
        class="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder:text-white/25 outline-none focus:border-accent/40 transition-colors"
      />
    </div>

    <!-- ── Search: no results ─────────────────────────────────────── -->
    <div v-if="isSearching && !anyVisible" class="py-16 text-center">
      <p class="text-white/30 text-sm">No settings match "<span class="text-white/50">{{ settingsSearch }}</span>"</p>
    </div>

    <!-- ── Music Folders ──────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Music Folders')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Music Folders</h2>

      <div class="space-y-2 mb-4">
        <div
          v-for="folder in library.folders"
          :key="folder"
          class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] group"
        >
          <div class="flex items-center gap-3 min-w-0">
            <svg
              class="w-5 h-5 text-white/30 shrink-0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <span class="text-sm text-white/70 truncate select-text">{{ folder }}</span>
          </div>

          <button
            @click="removeFolder(folder)"
            class="text-white/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          v-if="library.folders.length === 0"
          class="px-4 py-6 rounded-xl bg-white/[0.03] text-center"
        >
          <p class="text-sm text-white/30">No folders added yet</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          @click="library.addFolder()"
          :disabled="library.isScanning"
          class="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-full text-sm font-medium text-white transition-colors"
        >
          Add Folder
        </button>
        <button
          v-if="library.folders.length > 0"
          @click="library.rescanAll()"
          :disabled="library.isScanning"
          class="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed rounded-full text-sm font-medium text-white/80 transition-colors"
        >
          Rescan All
        </button>
      </div>

      <!-- Scan progress -->
      <div v-if="library.isScanning" class="mt-4 flex items-center gap-3">
        <div
          class="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin"
        />
        <span class="text-sm text-white/50">
          Scanning {{ library.scanProgress.current }}/{{ library.scanProgress.total }} files...
        </span>
      </div>
    </section>

    <!-- ── Library stats ──────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Library')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Library</h2>
      <div class="grid grid-cols-3 gap-4">
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-2xl font-bold text-white">{{ library.tracks.length }}</p>
          <p class="text-xs text-white/40">Songs</p>
        </div>
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-2xl font-bold text-white">{{ library.albums.length }}</p>
          <p class="text-xs text-white/40">Albums</p>
        </div>
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-2xl font-bold text-white">{{ library.artists.length }}</p>
          <p class="text-xs text-white/40">Artists</p>
        </div>
      </div>
    </section>

    <section v-show="showSection('general', 'Album Display')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Album Display</h2>
      <div class="space-y-4">
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Separate Soundtracks from Albums</p>
            <p class="text-xs text-white/30 mt-0.5">Hide soundtrack-tagged albums from Albums view and keep them in Soundtracks/Search</p>
          </div>
          <button
            @click="library.setSeparateSoundtracks(!library.separateSoundtracks)"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="library.separateSoundtracks ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="library.separateSoundtracks ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Show Singles in Albums View</p>
            <p class="text-xs text-white/30 mt-0.5">When disabled, one-track albums are hidden from Albums and still searchable</p>
          </div>
          <button
            @click="library.setIncludeSinglesInAlbums(!library.includeSinglesInAlbums)"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="library.includeSinglesInAlbums ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="library.includeSinglesInAlbums ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1">Soundtrack Tags</p>
          <p class="text-xs text-white/30 mb-3">Comma-separated tags considered soundtrack-only (used in Albums split and Soundtracks view)</p>
          <div class="flex items-center gap-2">
            <input
              v-model="soundtrackTagsInput"
              type="text"
              placeholder="soundtrack, game ost"
              class="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <button
              @click="saveSoundtrackTags"
              class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
            >
              Save
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Auto-tag Albums from Fetched Data</p>
            <p class="text-xs text-white/30 mt-0.5">Use genre metadata, if none is found, apply fetched artist tags (this might be inaccurate, use at your own risk)</p>
          </div>
          <button
            @click="toggleAutoTagAlbums"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="autoTagAlbumsFromApi ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="autoTagAlbumsFromApi ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- ── Discord Rich Presence ──────────────────────────────────── -->
    <section v-show="showSection('integrations', 'Discord Rich Presence')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Discord Rich Presence</h2>

      <div class="space-y-4">
        <!-- Enable/Disable -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Show activity in Discord</p>
            <p class="text-xs text-white/30 mt-0.5">Display what you're listening to on your Discord profile</p>
          </div>
          <button
            @click="toggleDiscord"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="discordEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="discordEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Display Format -->
        <div v-if="discordEnabled" class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-3">Display Format</p>
          <div class="space-y-2">
            <label
              v-for="option in rpcFormatOptions"
              :key="option.value"
              class="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              :class="discordFormat === option.value ? 'bg-white/[0.06] border border-accent/30' : 'hover:bg-white/[0.03] border border-transparent'"
            >
              <input
                type="radio"
                name="rpc-format"
                :value="option.value"
                v-model="discordFormat"
                @change="onFormatChange"
                class="mt-0.5 accent-accent"
              />
              <div class="min-w-0">
                <p class="text-sm text-white/80">{{ option.label }}</p>
                <p class="text-xs text-white/30 mt-0.5">{{ option.preview }}</p>
              </div>
            </label>
          </div>
        </div>

        <!-- Client ID -->
        <div v-if="discordEnabled" class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1">Discord Application ID</p>
          <p class="text-xs text-white/30 mb-3">Create an app at <span class="text-accent/70 select-text">discord.com/developers/applications</span> to customize the name shown in Discord. The app name becomes "Playing <strong>YourAppName</strong>".</p>
          <div class="flex items-center gap-2">
            <input
              v-model="discordClientId"
              type="text"
              placeholder="e.g. 1234567890123456789"
              class="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors select-text"
            />
            <button
              @click="saveClientId"
              class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Search ────────────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Search')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Search</h2>
      <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
        <div>
          <p class="text-sm text-white/80">Search in Lyrics</p>
          <p class="text-xs text-white/30 mt-0.5">Include downloaded .lrc lyrics files when searching your library</p>
        </div>
        <button
          @click="library.setSearchLyricsEnabled(!library.searchLyricsEnabled)"
          class="relative w-11 h-6 rounded-full transition-colors duration-200"
          :class="library.searchLyricsEnabled ? 'bg-accent' : 'bg-white/15'"
        >
          <div
            class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
            :class="library.searchLyricsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
          />
        </button>
      </div>
    </section>

    <!-- ── Audio Output ───────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Audio Output')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Audio Output</h2>
      <div class="space-y-4">
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-2">Output Device</p>
          <div class="relative" ref="deviceDropdownRef">
            <button
              @click.stop="showDeviceDropdown = !showDeviceDropdown"
              class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
              style="background: rgb(var(--app-text) / 0.06); border: 1px solid var(--border); color: rgb(var(--app-text) / 0.70)"
            >
              <span class="truncate">{{ selectedDeviceLabel }}</span>
              <svg class="w-4 h-4 shrink-0 ml-2 transition-transform" :class="showDeviceDropdown ? 'rotate-180' : ''" style="color: rgb(var(--app-text) / 0.30)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <Teleport to="body">
              <div v-if="showDeviceDropdown" class="fixed inset-0 z-[90]" @click="showDeviceDropdown = false" />
              <Transition name="dropdown">
                <div
                  v-if="showDeviceDropdown"
                  class="fixed rounded-xl menu-panel shadow-2xl py-1 z-[100] max-h-60 overflow-y-auto w-[min(100vw-2rem,32rem)]"
                  :style="deviceDropdownStyle"
                >
                  <button
                    @click="selectDevice('')"
                    class="w-full px-3.5 py-2 text-left text-sm transition-colors flex items-center justify-between"
                    :class="selectedDevice === '' ? 'text-accent bg-white/[0.08]' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'"
                  >
                    System Default
                    <svg v-if="selectedDevice === ''" class="w-3.5 h-3.5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  </button>
                  <button
                    v-for="d in player.audioDevices"
                    :key="d.deviceId"
                    @click="selectDevice(d.deviceId)"
                    class="w-full px-3.5 py-2 text-left text-sm transition-colors flex items-center justify-between"
                    :class="selectedDevice === d.deviceId ? 'text-accent bg-white/[0.08]' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'"
                  >
                    <span class="truncate mr-2">{{ d.label || `Device ${d.deviceId.slice(0, 8)}` }}</span>
                    <svg v-if="selectedDevice === d.deviceId" class="w-3.5 h-3.5 text-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  </button>
                </div>
              </Transition>
            </Teleport>
          </div>
        </div>
        <!-- Exclusive Mode — disabled for 2.6.0, will revisit later
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Exclusive Mode</p>
            <p class="text-xs text-white/30 mt-0.5">
              {{ exclusiveModeDescription }}
            </p>
            <p v-if="exclusiveNeedsRestart" class="text-xs text-amber-500/90 mt-1 flex items-center gap-1">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              Restart required to apply
            </p>
          </div>
          <button
            @click="toggleExclusive"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="exclusiveMode ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="exclusiveMode ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        ALSA device picker (Linux only, shown when exclusive is on)
        <div v-if="exclusiveMode && isLinux" class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1.5">ALSA Output Device</p>
          <p class="text-xs text-white/30 mb-2">Select a hardware device to bypass PipeWire/PulseAudio. Uses the ALSA <code class="text-white/40">hw:</code> interface for direct, exclusive access.</p>
          <select
            v-model="exclusiveAlsaDevice"
            @change="onAlsaDeviceChange"
            class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/70 outline-none focus:border-accent/40 transition-colors"
            :disabled="alsaLoading"
          >
            <option value="">None (use PipeWire/PulseAudio)</option>
            <option v-for="d in alsaDevices" :key="d.id" :value="d.id">
              {{ d.label }}
            </option>
          </select>
          <p v-if="alsaDevices.length === 0 && !alsaLoading" class="text-xs text-white/25 mt-1.5">No ALSA hardware devices found. Make sure <code class="text-white/35">alsa-utils</code> is installed.</p>
        </div>
        -->
      </div>
    </section>

    <!-- ── Playback ───────────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Playback')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Playback</h2>
      <div class="space-y-4">
        <!-- Audio normalization -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Audio Normalization</p>
            <p class="text-xs text-white/30 mt-0.5">Reduce volume differences between tracks using dynamic compression</p>
          </div>
          <button
            @click="toggleNormalization"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.normalization ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.normalization ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Crossfade -->
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm text-white/80">Crossfade</p>
              <p class="text-xs text-white/30 mt-0.5">Smoothly blend between tracks</p>
            </div>
            <button
              @click="player.setCrossfadeEnabled(!player.crossfadeEnabled)"
              class="relative w-11 h-6 rounded-full transition-colors duration-200"
              :class="player.crossfadeEnabled ? 'bg-accent' : 'bg-white/15'"
            >
              <div
                class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
                :class="player.crossfadeEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
              />
            </button>
          </div>
          <div v-if="player.crossfadeEnabled" class="flex items-center gap-3">
            <span class="text-xs text-white/40 w-4 text-right">1s</span>
            <input
              type="range" min="1" max="12" step="0.5"
              :value="player.crossfadeDuration"
              @input="player.setCrossfadeDuration(+($event.target as HTMLInputElement).value)"
              class="flex-1 accent-accent"
            />
            <span class="text-xs text-white/60 tabular-nums w-8">{{ player.crossfadeDuration }}s</span>
          </div>
        </div>

        <!-- Hand-made transitions -->
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-white/80">Hand-made transitions</p>
              <p class="text-xs text-white/30 mt-0.5">Play your saved transitions between songs (they take priority over crossfade)</p>
            </div>
            <button
              @click="player.setTransitionsEnabled(!player.transitionsEnabled)"
              class="relative w-11 h-6 rounded-full transition-colors duration-200"
              :class="player.transitionsEnabled ? 'bg-accent' : 'bg-white/15'"
            >
              <div
                class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
                :class="player.transitionsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
              />
            </button>
          </div>
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
            <div>
              <p class="text-sm text-white/80">Mix mode</p>
              <p class="text-xs text-white/30 mt-0.5">Choose each next song by following your transitions (falls back to the queue)</p>
            </div>
            <button
              @click="player.setMixMode(!player.mixMode)"
              class="relative w-11 h-6 rounded-full transition-colors duration-200"
              :class="player.mixMode ? 'bg-accent' : 'bg-white/15'"
            >
              <div
                class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
                :class="player.mixMode ? 'translate-x-[22px]' : 'translate-x-0.5'"
              />
            </button>
          </div>
        </div>

        <!-- Lyrics offset -->
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <div class="flex items-center justify-between mb-2">
            <div>
              <p class="text-sm text-white/80">Lyrics Offset</p>
              <p class="text-xs text-white/30 mt-0.5">Adjust lyrics timing (positive = earlier, negative = later)</p>
            </div>
            <span class="text-sm text-white/60 tabular-nums w-16 text-right">{{ lyricsOffsetDisplay }}s</span>
          </div>
          <div class="flex items-center gap-3">
            <button @click="adjustLyricsOffset(-0.5)" class="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/60 flex items-center justify-center transition-colors text-sm font-bold">−</button>
            <input
              type="range"
              min="-5"
              max="5"
              step="0.1"
              :value="player.lyricsOffset"
              @input="onLyricsOffsetInput"
              class="flex-1 accent-accent"
            />
            <button @click="adjustLyricsOffset(0.5)" class="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/60 flex items-center justify-center transition-colors text-sm font-bold">+</button>
            <button @click="resetLyricsOffset" class="text-xs text-white/30 hover:text-white/60 transition-colors">Reset</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Appearance ─────────────────────────────────────────────── -->
    <section v-show="showSection('appearance', 'Appearance')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Appearance</h2>
      <div class="space-y-4">
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Adaptive Accent Color</p>
            <p class="text-xs text-white/30 mt-0.5">Auto-adjust the accent color based on the current album's artwork</p>
          </div>
          <button
            @click="toggleAdaptiveAccent"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.adaptiveAccent ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.adaptiveAccent ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- iOS-style sliders -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">iOS-Style Sliders</p>
            <p class="text-xs text-white/30 mt-0.5">Replace standard sliders with pill-shaped iOS-style controls</p>
          </div>
          <button
            @click="toggleIOSSliders"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.iosSliders ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.iosSliders ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- Window transparency -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Window Transparency</p>
            <p class="text-xs text-white/30 mt-0.5">Enable glass-like transparency effect on the window background</p>
          </div>
          <button
            @click="toggleTransparency"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.transparencyEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.transparencyEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- Waveform progress bar -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Waveform Progress Bar</p>
            <p class="text-xs text-white/30 mt-0.5">Replace the standard progress bar with an audio waveform visualization</p>
          </div>
          <button
            @click="toggleWaveform"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.waveformEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.waveformEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- ── Animated Covers ────────────────────────────────────────── -->
    <section v-show="showSection('appearance', 'Animated Covers')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Animated Covers</h2>
      <div class="space-y-4">
        <!-- Toggle -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Motion Album Artwork</p>
            <p class="text-xs text-white/30 mt-0.5">Show animated album covers in fullscreen and album pages</p>
          </div>
          <button
            @click="toggleAnimatedCovers"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.animatedCoversEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.animatedCoversEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- Pause on focus loss -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Pause When Unfocused</p>
            <p class="text-xs text-white/30 mt-0.5">Pause animated covers when the window loses focus (e.g. clicking another app)</p>
          </div>
          <button
            @click="togglePauseAnimatedOnBlur"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.pauseAnimatedOnBlur ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.pauseAnimatedOnBlur ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- ── Behavior ───────────────────────────────────────────────── -->
    <section v-show="showSection('general', 'Behavior')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Behavior</h2>
      <div class="space-y-4">
        <!-- Tray icon toggle -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">System Tray Icon</p>
            <p class="text-xs text-white/30 mt-0.5">Show Aurora in the system tray; closing the window hides it instead of quitting</p>
          </div>
          <button
            @click="toggleTray"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.trayEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.trayEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- Auto-fullscreen toggle -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Auto-Fullscreen on Idle <span class="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-amber-500/15 text-amber-500">WIP</span></p>
            <p class="text-xs text-white/30 mt-0.5">Automatically enter fullscreen mode when the mouse is idle during playback</p>
          </div>
          <button
            @click="toggleAutoFullscreen"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="player.autoFullscreen ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="player.autoFullscreen ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>
        <!-- Auto-fullscreen delay -->
        <div v-if="player.autoFullscreen" class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Idle Timeout</p>
            <p class="text-xs text-white/30 mt-0.5">Seconds of inactivity before entering fullscreen</p>
          </div>
          <div class="flex items-center gap-2">
            <button @click="adjustAutoFullscreenDelay(-5)" class="w-7 h-7 rounded-lg bg-white/10 text-white/60 hover:text-white hover:bg-white/15 flex items-center justify-center text-sm transition-colors">&minus;</button>
            <input
              type="number"
              :value="player.autoFullscreenDelay"
              @change="onAutoFullscreenDelayChange"
              min="5"
              max="300"
              step="5"
              class="w-16 text-center text-sm text-white bg-white/10 rounded-lg px-2 py-1.5 border border-white/10 focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button @click="adjustAutoFullscreenDelay(5)" class="w-7 h-7 rounded-lg bg-white/10 text-white/60 hover:text-white hover:bg-white/15 flex items-center justify-center text-sm transition-colors">+</button>
            <span class="text-xs text-white/30 ml-1">sec</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Scrobbling ─────────────────────────────────────────────── -->
    <section v-show="showSection('integrations', 'Scrobbling')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">
        Scrobbling
        <span class="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500 uppercase tracking-wider align-middle">WIP</span>
      </h2>
      <div class="space-y-4">
        <!-- Enable scrobbling -->
        <div class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05]">
          <div>
            <p class="text-sm text-white/80">Enable Scrobbling</p>
            <p class="text-xs text-white/30 mt-0.5">Send your listening activity to Last.fm and/or ListenBrainz</p>
          </div>
          <button
            @click="toggleScrobbling"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="scrobblingEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="scrobblingEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Last.fm config -->
        <div v-if="scrobblingEnabled" class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1">Last.fm</p>
          <p class="text-xs text-white/30 mb-3">Create an API account at <span class="text-accent/70">last.fm/api/account/create</span></p>
          <div class="space-y-2">
            <input
              v-model="lastfmApiKey"
              type="text"
              placeholder="API Key"
              class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <input
              v-model="lastfmApiSecret"
              type="password"
              placeholder="API Secret"
              class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <input
              v-model="lastfmSessionKey"
              type="password"
              placeholder="Session Key"
              class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <button
              @click="saveLastfm"
              class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
            >
              Save Last.fm
            </button>
          </div>
        </div>

        <!-- ListenBrainz config -->
        <div v-if="scrobblingEnabled" class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1">ListenBrainz</p>
          <p class="text-xs text-white/30 mb-3">Get your token at <span class="text-accent/70">listenbrainz.org/settings</span></p>
          <div class="flex items-center gap-2">
            <input
              v-model="listenbrainzToken"
              type="password"
              placeholder="User Token"
              class="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <button
              @click="saveListenbrainz"
              class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Navidrome / Subsonic ─────────────────────────────────── -->
    <section v-show="showSection('integrations', 'Navidrome / Subsonic')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">
        Navidrome / Subsonic
        <span class="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500 uppercase tracking-wider align-middle">WIP</span>
      </h2>

      <div class="px-4 py-4 rounded-xl bg-white/[0.05] space-y-4">
        <p class="text-xs text-white/40">Connect to a Navidrome or Subsonic-compatible server to stream your remote library alongside local files.</p>

        <div class="space-y-2">
          <input
            v-model="subsonicUrl"
            type="url"
            placeholder="Server URL (e.g. https://navidrome.example.com)"
            class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
          />
          <div class="grid grid-cols-2 gap-2">
            <input
              v-model="subsonicUsername"
              type="text"
              placeholder="Username"
              class="px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
            <input
              v-model="subsonicPassword"
              type="password"
              placeholder="Password"
              class="px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
            />
          </div>
        </div>

        <!-- Legacy auth toggle -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Legacy Authentication</span>
            <p class="text-xs text-white/30">Use password-based auth instead of token (for older servers)</p>
          </div>
          <button
            @click="subsonicLegacyAuth = !subsonicLegacyAuth"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="subsonicLegacyAuth ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="subsonicLegacyAuth ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2">
          <button
            @click="testSubsonic"
            :disabled="subsonicTesting || !subsonicUrl || !subsonicUsername || !subsonicPassword"
            class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {{ subsonicTesting ? 'Testing...' : 'Test Connection' }}
          </button>
          <button
            @click="syncSubsonicLibrary"
            :disabled="subsonicSyncing || !subsonicConnected"
            class="px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white/70 hover:text-white/90 transition-all"
          >
            {{ subsonicSyncing ? 'Syncing...' : 'Sync Library' }}
          </button>
          <button
            v-if="subsonicConnected"
            @click="disconnectSubsonic"
            class="px-4 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-sm font-medium text-red-400 hover:text-red-300 transition-all"
          >
            Disconnect
          </button>
        </div>

        <!-- Connection status -->
        <div v-if="subsonicConnected" class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-green-400" />
          <span class="text-xs text-green-400/80">Connected</span>
        </div>
      </div>
    </section>

    <!-- ── Remote Control ───────────────────────────────────────── -->
    <section v-show="showSection('integrations', 'Remote Control')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Remote Control</h2>

      <div class="px-4 py-4 rounded-xl bg-white/[0.05] space-y-4">
        <p class="text-xs text-white/40">Control Aurora from your phone on the same network. Open the URL below in your mobile browser and enter the PIN to connect.</p>

        <!-- Enable toggle -->
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-white/80">Enable Remote Control</p>
            <p class="text-xs text-white/30 mt-0.5">Start a local server for mobile remote access</p>
          </div>
          <button
            @click="toggleRemote"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="remoteEnabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="remoteEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <template v-if="remoteEnabled">
          <!-- Connection info -->
          <div class="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2">Connection</p>
            <div class="flex items-center gap-3">
              <div class="flex-1 space-y-0.5">
                <p
                  v-for="ip in remoteLanIps"
                  :key="ip"
                  class="text-sm text-white/70 font-mono select-all"
                >http://{{ ip }}:{{ remotePort }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-white/30">PIN</span>
                <span class="text-lg font-bold font-mono text-accent tracking-widest select-all">{{ remotePin }}</span>
                <button
                  @click="regeneratePin"
                  class="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-all"
                  title="Generate new PIN"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Trusted devices -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-white/30">Trusted Devices ({{ remoteTrustedDevices.length }})</p>
              <button
                v-if="remoteTrustedDevices.length > 0"
                @click="removeAllDevices"
                class="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
              >
                Revoke All
              </button>
            </div>
            <div v-if="remoteTrustedDevices.length === 0" class="text-xs text-white/20 py-2">
              No devices paired yet. Enter the PIN on your phone to connect.
            </div>
            <div v-else class="space-y-1.5">
              <div
                v-for="(device, i) in remoteTrustedDevices"
                :key="i"
                class="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03]"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-xs text-white/60 truncate">{{ device.name }}</p>
                  <p class="text-[10px] text-white/25">{{ device.ip }} · Last seen {{ formatDeviceTime(device.lastSeen) }}</p>
                </div>
                <button
                  @click="removeDevice(i)"
                  class="p-1 rounded hover:bg-white/[0.08] text-white/20 hover:text-red-400 transition-all shrink-0 ml-2"
                  title="Revoke access"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- ── Cache Management ─────────────────────────────────────── -->
    <section v-show="showSection('system', 'Cache')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Cache</h2>

      <div class="px-4 py-4 rounded-xl bg-white/[0.05] space-y-3">
        <p class="text-xs text-white/40 mb-3">Clear cached data to free up disk space or resolve display issues. Library data will be rebuilt on next scan.</p>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Cover Art Cache</span>
            <p class="text-xs text-white/30">Extracted album artwork thumbnails</p>
          </div>
          <button
            @click="clearCache('covers')"
            :disabled="cacheClearing.covers"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/60 hover:text-white/80 transition-all disabled:opacity-40"
          >
            {{ cacheClearing.covers ? 'Clearing...' : 'Clear' }}
          </button>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Artist Info Cache</span>
            <p class="text-xs text-white/30">Biographies, images, tags from APIs</p>
          </div>
          <button
            @click="clearCache('artist')"
            :disabled="cacheClearing.artist"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/60 hover:text-white/80 transition-all disabled:opacity-40"
          >
            {{ cacheClearing.artist ? 'Clearing...' : 'Clear' }}
          </button>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Waveform Cache</span>
            <p class="text-xs text-white/30">Pre-generated audio waveform data</p>
          </div>
          <button
            @click="clearCache('waveform')"
            :disabled="cacheClearing.waveform"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/60 hover:text-white/80 transition-all disabled:opacity-40"
          >
            {{ cacheClearing.waveform ? 'Clearing...' : 'Clear' }}
          </button>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Library Index</span>
            <p class="text-xs text-white/30">Song metadata index — rescan folders after clearing</p>
          </div>
          <button
            @click="clearCache('library')"
            :disabled="cacheClearing.library"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/60 hover:text-white/80 transition-all disabled:opacity-40"
          >
            {{ cacheClearing.library ? 'Clearing...' : 'Clear' }}
          </button>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm text-white/70">Animated Covers</span>
            <p class="text-xs text-white/30">Cached motion artwork URLs</p>
          </div>
          <button
            @click="clearAnimatedCoverCache"
            :disabled="cacheClearing.animated"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/60 hover:text-white/80 transition-all disabled:opacity-40"
          >
            {{ cacheClearing.animated ? 'Clearing...' : 'Clear' }}
          </button>
        </div>

        <div class="border-t border-white/[0.06] pt-3">
          <button
            @click="clearAllCaches"
            :disabled="Object.values(cacheClearing).some(Boolean)"
            class="px-5 py-2 rounded-full text-sm font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-all disabled:opacity-40"
          >
            Clear All Caches
          </button>
        </div>
      </div>
    </section>

    <!-- ── Sync ──────────────────────────────────────────────────── -->
    <section v-show="showSection('sync', 'Sync Folder')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-1">Sync Folder</h2>
      <p class="text-xs text-white/40 mb-4">
        Point Aurora to any folder managed by Dropbox, Google Drive, Syncthing, or similar.
        Aurora will read and write <span class="font-mono text-white/60">aurora-sync.json</span> there to keep playlists and favorites in sync across devices — no account required.
      </p>

      <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
        <!-- Enable toggle -->
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <p class="text-sm text-white/80">Enable Sync</p>
            <p class="text-xs text-white/30 mt-0.5">Automatically push and pull changes via the sync file</p>
          </div>
          <button
            @click="toggleSync"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="syncConfig.enabled ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="syncConfig.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Folder picker -->
        <div class="px-4 py-3">
          <p class="text-sm text-white/70 mb-2">Sync Folder</p>
          <div class="flex items-center gap-2">
            <div class="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm truncate select-text"
              :class="syncConfig.folder ? 'text-white/70' : 'text-white/25'">
              {{ syncConfig.folder || 'No folder selected' }}
            </div>
            <button
              v-if="syncConfig.folder"
              @click="openSyncFolder()"
              class="p-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/40 hover:text-white/70 transition-all shrink-0"
              title="Open folder"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </button>
            <button
              @click="chooseSyncFolder"
              class="px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-sm font-medium text-white/60 hover:text-white/80 transition-all shrink-0"
            >
              Browse
            </button>
          </div>
        </div>

        <!-- What to sync -->
        <div class="px-4 py-3 space-y-2">
          <p class="text-sm text-white/70 mb-1">What to sync</p>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" v-model="syncConfig.syncPlaylists" @change="saveSyncConfig"
              class="w-4 h-4 rounded accent-accent" />
            <span class="text-sm text-white/70">Playlists</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" v-model="syncConfig.syncFavorites" @change="saveSyncConfig"
              class="w-4 h-4 rounded accent-accent" />
            <span class="text-sm text-white/70">Favorites</span>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" v-model="syncConfig.syncStats" @change="saveSyncConfig"
              class="w-4 h-4 rounded accent-accent mt-0.5" />
            <div>
              <span class="text-sm text-white/70">Play History</span>
              <p class="text-xs text-white/30 mt-0.5">Each device writes its own history file — Stats view shows combined plays from all devices</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" v-model="syncConfig.syncTags" @change="saveSyncConfig"
              class="w-4 h-4 rounded accent-accent mt-0.5" />
            <div>
              <span class="text-sm text-white/70">Tags</span>
              <p class="text-xs text-white/30 mt-0.5">Tags are merged across devices — tags added on any device are combined</p>
            </div>
          </label>
        </div>

        <!-- Status + actions -->
        <div class="px-4 py-3 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p v-if="syncStore.syncError" class="text-xs text-red-400 truncate">{{ syncStore.syncError }}</p>
            <p v-else-if="syncStore.lastSynced" class="text-xs text-white/30">
              Last synced {{ formatSyncTime(syncStore.lastSynced) }}
            </p>
            <p v-else class="text-xs text-white/25">Not synced yet</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="syncStore.pull()"
              :disabled="syncStore.syncing || !syncConfig.enabled || !syncConfig.folder"
              class="px-4 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-30 text-xs font-medium text-white/70 hover:text-white/90 transition-all"
            >
              Pull
            </button>
            <button
              @click="syncStore.push()"
              :disabled="syncStore.syncing || !syncConfig.enabled || !syncConfig.folder"
              class="px-4 py-1.5 rounded-lg bg-accent/20 hover:bg-accent/30 disabled:opacity-30 text-xs font-medium text-accent border border-accent/20 transition-all"
            >
              {{ syncStore.syncing ? 'Syncing…' : 'Push Now' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Export / Import ──────────────────────────────────────── -->
    <section v-show="showSection('system', 'Export / Import')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">
        Export / Import
        <span class="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500 uppercase tracking-wider align-middle">WIP</span>
      </h2>

      <div class="px-4 py-4 rounded-xl bg-white/[0.05] space-y-4">
        <p class="text-xs text-white/40">Backup your settings, favorites, and playlists. Auto-exports run in the background whenever data changes.</p>

        <!-- Auto-export toggle -->
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-white/80">Auto-Export on Change</p>
            <p class="text-xs text-white/30 mt-0.5">Automatically save a backup when settings, favorites, or playlists change</p>
          </div>
          <button
            @click="toggleAutoExport"
            class="relative w-11 h-6 rounded-full transition-colors duration-200"
            :class="autoExport ? 'bg-accent' : 'bg-white/15'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
              :class="autoExport ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </div>

        <!-- Export path -->
        <div>
          <p class="text-sm text-white/70 mb-2">Export Location</p>
          <div class="flex items-center gap-2">
            <div class="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/50 truncate select-text">
              {{ exportPath || exportDefaultPath || 'Default (app data)' }}
            </div>
            <button
              @click="openExportFolder"
              class="p-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white/40 hover:text-white/70 transition-all shrink-0"
              title="Open folder"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </button>
            <button
              @click="chooseExportPath"
              class="px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-sm font-medium text-white/60 hover:text-white/80 transition-all shrink-0"
            >
              Browse
            </button>
            <button
              v-if="exportPath"
              @click="resetExportPath"
              class="px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-xs text-white/40 hover:text-white/60 transition-all shrink-0"
            >
              Reset
            </button>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2 pt-1">
          <button
            @click="runExport"
            :disabled="exporting"
            class="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 text-sm font-medium text-white transition-colors"
          >
            {{ exporting ? 'Exporting...' : 'Export Now' }}
          </button>
          <button
            @click="runImport"
            :disabled="importing"
            class="px-5 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-40 text-sm font-medium text-white/70 hover:text-white/90 transition-all"
          >
            {{ importing ? 'Importing...' : 'Import Backup' }}
          </button>
        </div>
      </div>
    </section>

    <!-- ── Troubleshooting ────────────────────────────────────── -->
    <section v-show="showSection('system', 'Troubleshooting')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">Troubleshooting</h2>
      <div class="px-4 py-4 rounded-xl bg-white/[0.05] space-y-3">
        <p class="text-xs text-white/40">Aurora writes diagnostic logs to help troubleshoot issues. Share the log file when reporting bugs.</p>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-white/80">Log File</p>
            <p class="text-xs text-white/30 mt-0.5 break-all">{{ logFilePath || 'Loading...' }}</p>
          </div>
          <button
            @click="openLogFile"
            class="px-4 py-1.5 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-all"
          >
            Open Log Folder
          </button>
        </div>
      </div>
    </section>

    <!-- ── Themes ──────────────────────────────────────────────────── -->
    <section v-show="showSection('appearance', 'Themes')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">
        Themes
        <span class="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500 uppercase tracking-wider align-middle">WIP</span>
      </h2>

      <div class="space-y-4">
        <!-- Theme picker -->
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-3">Active Theme</p>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="t in themeStore.themes"
              :key="t.id"
              @click="themeStore.applyTheme(t)"
              class="px-3 py-2.5 rounded-lg text-left transition-all border"
              :class="themeStore.currentTheme.id === t.id
                ? 'bg-accent/10 border-accent/30 text-white'
                : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06] text-white/60 hover:text-white/80'"
            >
              <p class="text-sm font-medium truncate">{{ t.name }}</p>
              <p class="text-[10px] text-white/30 truncate">{{ t.author }}</p>
            </button>
          </div>
        </div>

        <!-- Custom CSS -->
        <div class="px-4 py-3 rounded-xl bg-white/[0.05]">
          <p class="text-sm text-white/80 mb-1">Custom CSS</p>
          <p class="text-xs text-white/30 mb-3">Override any styles — paste raw CSS that targets Aurora's variables or elements.</p>
          <textarea
            v-model="themeCustomCSS"
            rows="5"
            placeholder=":root { --accent: 139 92 246 !important; }"
            class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-xs text-white/80 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors font-mono resize-y select-text"
          />
          <div class="flex items-center gap-2 mt-2">
            <button
              @click="applyCustomCSS"
              class="px-4 py-1.5 rounded-full text-xs font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
            >
              Apply
            </button>
            <button
              @click="clearCustomCSS"
              class="px-4 py-1.5 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <!-- Reset -->
        <div class="flex items-center gap-3">
          <button
            @click="themeStore.resetTheme()"
            class="px-4 py-2 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
          >
            Reset to Default Theme
          </button>
          <button
            @click="themeStore.openThemesFolder()"
            class="px-4 py-2 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
          >
            Open Themes Folder
          </button>
          <button
            @click="themeStore.loadThemes()"
            class="px-4 py-2 rounded-full text-xs font-medium bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white/90 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </section>

    <!-- ── Plugins ──────────────────────────────────────────────────── -->
    <section v-show="showSection('plugins', 'Plugins')" class="mb-8">
      <h2 class="text-lg font-semibold text-white mb-4">
        Plugins
        <span class="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500 uppercase tracking-wider align-middle">WIP</span>
      </h2>

      <div class="space-y-4">
        <!-- Installed plugins -->
        <div v-if="pluginStore.manifests.length > 0" class="space-y-2">
          <div
            v-for="manifest in pluginStore.manifests"
            :key="manifest.id"
            class="rounded-xl bg-white/[0.05] group overflow-hidden"
          >
            <div class="flex items-center justify-between px-4 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium text-white truncate">{{ manifest.name }}</p>
                  <span class="text-[10px] text-white/20 shrink-0">v{{ manifest.version }}</span>
                  <span
                    v-if="pluginNeedsNewerAurora(manifest.minAuroraVersion)"
                    class="text-[10px] font-medium text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0"
                    :title="`Requires Aurora v${manifest.minAuroraVersion} or newer (installed: v${appVersion})`"
                  >requires v{{ manifest.minAuroraVersion }}+</span>
                </div>
                <p v-if="manifest.description" class="text-xs text-white/30 mt-0.5">{{ manifest.description }}</p>
                <p class="text-[10px] text-white/20 mt-0.5">by {{ manifest.author }}</p>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <!-- Settings button (only when enabled & has schema) -->
                <button
                  v-if="pluginStore.enabledIds.includes(manifest.id) && hasPluginSettings(manifest.id)"
                  @click="togglePluginSettings(manifest.id)"
                  class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                  :class="expandedPluginSettings === manifest.id ? 'text-accent bg-accent/10' : 'text-white/30 hover:text-white/60 hover:bg-white/[0.06]'"
                  title="Plugin settings"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>

                <!-- Enable / disable toggle -->
                <button
                  @click="pluginStore.toggle(manifest.id)"
                  class="relative w-11 h-6 rounded-full transition-colors duration-200"
                  :class="pluginStore.enabledIds.includes(manifest.id) ? 'bg-accent' : 'bg-white/15'"
                >
                  <div
                    class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
                    :class="pluginStore.enabledIds.includes(manifest.id) ? 'translate-x-[22px]' : 'translate-x-0.5'"
                  />
                </button>

                <!-- Remove -->
                <button
                  @click="removePlugin(manifest.id, manifest.name)"
                  class="text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove plugin"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Expanded plugin settings -->
            <div
              v-if="expandedPluginSettings === manifest.id && pluginSettingValues[manifest.id]"
              class="px-4 pb-4 pt-1 border-t border-white/[0.06] space-y-3"
            >
              <div
                v-for="(field, key) in getPluginSchema(manifest.id)"
                :key="key"
              >
                <!-- Boolean toggle -->
                <label v-if="field.type === 'boolean'" class="flex items-center justify-between cursor-pointer">
                  <div class="min-w-0">
                    <span class="text-sm text-white/70">{{ field.label }}</span>
                    <p v-if="field.description" class="text-[11px] text-white/30 mt-0.5">{{ field.description }}</p>
                  </div>
                  <button
                    @click="updatePluginSetting(manifest.id, String(key), !pluginSettingValues[manifest.id]?.[key])"
                    class="relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ml-3"
                    :class="pluginSettingValues[manifest.id]?.[key] ? 'bg-accent' : 'bg-white/15'"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-control shadow transition-transform duration-200"
                      :class="pluginSettingValues[manifest.id]?.[key] ? 'translate-x-4' : ''"
                    />
                  </button>
                </label>

                <!-- Select dropdown -->
                <div v-else-if="field.type === 'select'">
                  <p class="text-sm text-white/70 mb-1">{{ field.label }}</p>
                  <p v-if="field.description" class="text-[11px] text-white/30 mb-2">{{ field.description }}</p>
                  <select
                    :value="pluginSettingValues[manifest.id]?.[key]"
                    @change="updatePluginSetting(manifest.id, String(key), ($event.target as HTMLSelectElement).value)"
                    class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/70 outline-none focus:border-accent/40 transition-colors"
                  >
                    <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                </div>

                <!-- String input -->
                <div v-else-if="field.type === 'string'">
                  <p class="text-sm text-white/70 mb-1">{{ field.label }}</p>
                  <p v-if="field.description" class="text-[11px] text-white/30 mb-2">{{ field.description }}</p>
                  <input
                    type="text"
                    :value="pluginSettingValues[manifest.id]?.[key]"
                    @change="updatePluginSetting(manifest.id, String(key), ($event.target as HTMLInputElement).value)"
                    class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/70 placeholder:text-white/20 outline-none focus:border-accent/40 transition-colors"
                  />
                </div>

                <!-- Number input -->
                <div v-else-if="field.type === 'number'">
                  <p class="text-sm text-white/70 mb-1">{{ field.label }}</p>
                  <p v-if="field.description" class="text-[11px] text-white/30 mb-2">{{ field.description }}</p>
                  <input
                    type="number"
                    :value="pluginSettingValues[manifest.id]?.[key]"
                    @change="updatePluginSetting(manifest.id, String(key), parseFloat(($event.target as HTMLInputElement).value))"
                    class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/70 outline-none focus:border-accent/40 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="px-4 py-6 rounded-xl bg-white/[0.03] text-center">
          <p class="text-sm text-white/30">No plugins installed</p>
          <p class="text-xs text-white/20 mt-1">Drop plugin folders into the plugins directory to get started</p>
        </div>

        <div class="flex items-center gap-3">
          <button
            @click="pluginStore.openPluginsFolder()"
            class="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.12] rounded-full text-sm font-medium text-white/80 transition-colors"
          >
            Open Plugins Folder
          </button>
          <button
            @click="pluginStore.refreshManifests()"
            class="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.12] rounded-full text-sm font-medium text-white/80 transition-colors"
          >
            Refresh
          </button>
        </div>

        <!-- Warning notice -->
        <div class="px-4 py-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/10">
          <p class="text-xs text-amber-500/70 leading-relaxed">
            <strong class="text-amber-500/90">Use at your own risk.</strong>
            Plugins run with full access and are not sandboxed. Only install plugins from sources you trust.
          </p>
        </div>
      </div>
    </section>

    <!-- ── About ──────────────────────────────────────────────────── -->
    <section v-show="showSection('system', 'About')">
      <h2 class="text-lg font-semibold text-white mb-4">About</h2>
      <div class="px-4 py-4 rounded-xl bg-white/[0.05]">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-3 h-3 rounded-full bg-accent" />
          <span class="text-sm font-semibold text-white">Aurora Player</span>
        </div>
        <p class="text-xs text-white/40 leading-relaxed">
          A beautiful local music player for Linux. Supports MP3, FLAC, OGG, WAV, M4A and more.
          Place .lrc files alongside your music for synced lyrics.
        </p>
        <p class="text-xs text-white/30 mt-2">Version {{ appVersion }}</p>
      </div>
    </section>
  </div>

  <!-- Restart dialog -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="showRestartDialog" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="glass-heavy border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
          <h3 class="text-lg font-semibold text-[var(--text-primary)] mb-2">{{ restartDialogTitle }}</h3>
          <p class="text-sm text-[var(--text-secondary)] mb-6">{{ restartDialogMessage }}</p>
          <div class="flex items-center justify-end gap-3">
            <button
              @click="dismissRestart"
              class="px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-sm font-medium text-white/60 hover:text-white/80 transition-colors"
            >
              Later
            </button>
            <button
              @click="restartApp"
              class="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
            >
              Restart Now
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Plugin delete confirmation dialog -->
  <ConfirmDialog
    :show="deletePluginDialog.show"
    title="Remove Plugin"
    :message="`Are you sure you want to remove &quot;${deletePluginDialog.pluginName}&quot;? This will delete the plugin files and cannot be undone.`"
    confirm-label="Remove"
    cancel-label="Cancel"
    variant="danger"
    @confirm="onDeletePluginConfirm"
    @cancel="deletePluginDialog.show = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useFavoritesStore } from '@/stores/favorites'
import { useThemeStore } from '@/stores/theme'
import { usePluginStore } from '@/stores/plugins'
import { useSyncStore } from '@/stores/sync'
import { useToast } from '@/composables/useToast'
import { getPluginSettingsSchema, notifyPluginSettingChanged } from '@/plugins'
import type { PluginSettingField } from '@/types/plugin'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const favoritesStore = useFavoritesStore()
const themeStore = useThemeStore()
const pluginStore = usePluginStore()
const syncStore = useSyncStore()
const toast = useToast()

const appVersion = __APP_VERSION__

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va !== vb) return va - vb
  }
  return 0
}

function pluginNeedsNewerAurora(minVersion?: string): boolean {
  if (!minVersion) return false
  return compareVersions(appVersion, minVersion) < 0
}

// ── Sync ────────────────────────────────────────────────────────────────
const syncConfig = ref<SyncConfig>({ enabled: false, folder: '', syncPlaylists: true, syncFavorites: true, syncStats: true, syncTags: true })

async function loadSyncConfig() {
  syncConfig.value = await window.api.syncGetConfig()
  syncStore.config = syncConfig.value
}

async function saveSyncConfig() {
  await syncStore.saveConfig({ ...syncConfig.value })
}

async function toggleSync() {
  syncConfig.value.enabled = !syncConfig.value.enabled
  await saveSyncConfig()
}

async function chooseSyncFolder() {
  const folder = await syncStore.pickFolder()
  if (folder) {
    syncConfig.value.folder = folder
    await saveSyncConfig()
  }
}

function openSyncFolder() {
  if (syncConfig.value.folder) window.api.openPath(syncConfig.value.folder)
}

function formatSyncTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

// ── Tab navigation ─────────────────────────────────────────────────────
const activeTab = ref('general')
const tabs = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'sync', label: 'Sync' },
  { id: 'system', label: 'System' },
]

// ── Settings search ────────────────────────────────────────────────────
const settingsSearch = ref('')
const isSearching = computed(() => settingsSearch.value.trim().length > 0)

const sectionKeywords: Record<string, string[]> = {
  'Music Folders': ['folder', 'scan', 'rescan', 'add folder', 'music library'],
  'Library': ['songs', 'albums', 'artists', 'stats', 'count'],
  'Album Display': ['soundtrack', 'singles', 'tags', 'auto-tag', 'display', 'covers'],
  'Discord Rich Presence': ['discord', 'rpc', 'activity', 'presence', 'status'],
  'Search': ['search lyrics', 'lyrics search'],
  'Audio Output': ['audio', 'output', 'device', 'speaker', 'sound', 'sink'],
  'Playback': ['playback', 'queue', 'shuffle', 'crossfade', 'player', 'volume', 'gapless', 'transitions', 'mix'],
  'Appearance': ['theme', 'color', 'accent', 'font', 'ui', 'dark', 'window', 'opacity', 'blur'],
  'Animated Covers': ['animation', 'cover', 'album art', 'animated'],
  'Behavior': ['behavior', 'window', 'minimize', 'tray', 'startup', 'close'],
  'Scrobbling': ['lastfm', 'last.fm', 'scrobble', 'last fm'],
  'Navidrome / Subsonic': ['navidrome', 'subsonic', 'remote server', 'jellyfin', 'stream'],
  'Remote Control': ['remote', 'control', 'mpris', 'media keys', 'keyboard'],
  'Cache': ['cache', 'clear', 'storage', 'disk', 'memory'],
  'Sync Folder': ['sync', 'cloud', 'dropbox', 'backup', 'cross-device', 'playlists sync', 'favorites sync'],
  'Export / Import': ['export', 'import', 'backup', 'restore', 'data'],
  'Troubleshooting': ['troubleshoot', 'debug', 'logs', 'reset', 'diagnostic'],
  'Themes': ['themes', 'custom theme', 'css', 'custom css'],
  'Plugins': ['plugins', 'extensions', 'addons', 'add-ons'],
  'About': ['about', 'version', 'update', 'changelog', 'app info'],
}

function showSection(tabId: string, heading: string): boolean {
  if (!isSearching.value) return activeTab.value === tabId
  const q = settingsSearch.value.toLowerCase().trim()
  const keywords = sectionKeywords[heading] ?? []
  return [heading.toLowerCase(), tabId, ...keywords].some(k => k.includes(q))
}

const sectionTabMap: Record<string, string> = {
  'Music Folders': 'general', 'Library': 'general', 'Album Display': 'general',
  'Discord Rich Presence': 'integrations', 'Search': 'general', 'Audio Output': 'general',
  'Playback': 'general', 'Appearance': 'appearance', 'Animated Covers': 'appearance',
  'Behavior': 'general', 'Scrobbling': 'integrations', 'Navidrome / Subsonic': 'integrations',
  'Remote Control': 'integrations', 'Cache': 'system', 'Sync Folder': 'sync',
  'Export / Import': 'system', 'Troubleshooting': 'system', 'Themes': 'appearance',
  'Plugins': 'plugins', 'About': 'system',
}

const anyVisible = computed(() =>
  isSearching.value && Object.entries(sectionTabMap).some(([heading, tabId]) => showSection(tabId, heading))
)

// ── Theme / Plugin helpers ─────────────────────────────────────────────
const themeCustomCSS = ref('')

function applyCustomCSS() {
  if (themeCustomCSS.value.trim()) {
    themeStore.loadCustomCSS(themeCustomCSS.value)
    toast.success('Custom CSS applied')
  }
}

function clearCustomCSS() {
  themeCustomCSS.value = ''
  themeStore.unloadCustomCSS()
  toast.success('Custom CSS cleared')
}

const deletePluginDialog = reactive({ show: false, pluginId: '', pluginName: '' })

function removePlugin(pluginId: string, name: string) {
  deletePluginDialog.pluginId = pluginId
  deletePluginDialog.pluginName = name
  deletePluginDialog.show = true
}

async function onDeletePluginConfirm() {
  deletePluginDialog.show = false
  await pluginStore.remove(deletePluginDialog.pluginId)
  toast.success(`Plugin "${deletePluginDialog.pluginName}" removed`)
}

// ── Plugin settings ────────────────────────────────────────────────────
/** Which plugin has its settings panel expanded */
const expandedPluginSettings = ref<string | null>(null)
/** Loaded setting values per plugin: { pluginId: { key: value } } */
const pluginSettingValues = reactive<Record<string, Record<string, any>>>({})

watch(() => pluginStore.enabledIds, (enabledIds) => {
  if (expandedPluginSettings.value && !enabledIds.includes(expandedPluginSettings.value)) {
    expandedPluginSettings.value = null
  }
})

function hasPluginSettings(pluginId: string): boolean {
  const manifest = pluginStore.manifests.find(m => m.id === pluginId)
  const manifestSchema = manifest?.settingsSchema
  const runtimeSchema = getPluginSettingsSchema(pluginId)
  return !!(manifestSchema && Object.keys(manifestSchema).length > 0) ||
         !!(runtimeSchema && Object.keys(runtimeSchema).length > 0)
}

function getPluginSchema(pluginId: string): Record<string, PluginSettingField> {
  const manifest = pluginStore.manifests.find(m => m.id === pluginId)
  const manifestSchema = manifest?.settingsSchema ?? {}
  const runtimeSchema = getPluginSettingsSchema(pluginId) ?? {}
  return { ...manifestSchema, ...runtimeSchema }
}

async function togglePluginSettings(pluginId: string) {
  if (expandedPluginSettings.value === pluginId) {
    expandedPluginSettings.value = null
    return
  }
  // Load current values
  if (!pluginSettingValues[pluginId]) {
    const saved = await window.api.pluginsGetSettings(pluginId) || {}
    const schema = getPluginSchema(pluginId)
    const merged: Record<string, any> = {}
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = key in saved ? saved[key] : field.default
    }
    pluginSettingValues[pluginId] = merged
  }
  expandedPluginSettings.value = pluginId
}

async function updatePluginSetting(pluginId: string, key: string, value: any) {
  if (!pluginSettingValues[pluginId]) pluginSettingValues[pluginId] = {}
  pluginSettingValues[pluginId][key] = value
  // Persist
  const current = await window.api.pluginsGetSettings(pluginId) || {}
  current[key] = value
  await window.api.pluginsSaveSettings(pluginId, current)
  // Notify plugin
  notifyPluginSettingChanged(pluginId, key, value)
}

const discordEnabled = ref(true)
const discordFormat = ref('title-artist')
const discordClientId = ref('')

// Audio output
const selectedDevice = ref('')
const showDeviceDropdown = ref(false)
const deviceDropdownRef = ref<HTMLElement | null>(null)
const deviceDropdownStyle = computed(() => {
  if (!deviceDropdownRef.value) return {}
  const rect = deviceDropdownRef.value.getBoundingClientRect()
  return {
    top: `${rect.bottom + 6}px`,
    left: `${Math.min(rect.left, window.innerWidth - 320)}px`,
  }
})

const selectedDeviceLabel = computed(() => {
  if (!selectedDevice.value) return 'System Default'
  const d = player.audioDevices.find(d => d.deviceId === selectedDevice.value)
  return d ? (d.label || `Device ${d.deviceId.slice(0, 8)}`) : 'System Default'
})

function selectDevice(deviceId: string) {
  selectedDevice.value = deviceId
  showDeviceDropdown.value = false
  onDeviceChange()
}

function onDeviceClickOutside(e: MouseEvent) {
  if (deviceDropdownRef.value && !deviceDropdownRef.value.contains(e.target as Node)) {
    showDeviceDropdown.value = false
  }
}
const exclusiveMode = ref(false)
const exclusiveModeActiveAtStartup = ref(false) // whether flags were applied at process level
const exclusivePlatform = ref('')
const exclusiveAlsaDevice = ref('') // selected ALSA hw: device for Linux exclusive
const alsaDevices = ref<{ id: string; name: string; label: string }[]>([])
const alsaLoading = ref(false)

const exclusiveNeedsRestart = computed(() => {
  // Restart needed when the setting doesn't match the active process state
  return exclusiveMode.value !== exclusiveModeActiveAtStartup.value
})

const isLinux = computed(() => exclusivePlatform.value === 'linux')

const exclusiveModeDescription = computed(() => {
  if (exclusivePlatform.value === 'win32') {
    return 'Bypass Windows audio mixer (WASAPI Exclusive) for bit-perfect output'
  }
  if (exclusiveAlsaDevice.value) {
    return `ALSA exclusive output to ${exclusiveAlsaDevice.value} — bypasses PipeWire/PulseAudio completely`
  }
  return 'Bypass PipeWire/PulseAudio by routing audio directly to an ALSA hardware device'
})

// Scrobbling
const scrobblingEnabled = ref(false)
const lastfmApiKey = ref('')
const lastfmApiSecret = ref('')
const lastfmSessionKey = ref('')
const listenbrainzToken = ref('')

// Logging
const logFilePath = ref('')

// Subsonic / Navidrome
const subsonicUrl = ref('')
const subsonicUsername = ref('')
const subsonicPassword = ref('')
const subsonicLegacyAuth = ref(false)
const subsonicTesting = ref(false)
const subsonicSyncing = ref(false)
const subsonicConnected = ref(false)

// Export / Import
const autoExport = ref(true)
const exportPath = ref('')
const exportDefaultPath = ref('')
const exporting = ref(false)
const importing = ref(false)
const autoTagAlbumsFromApi = ref(false)
const soundtrackTagsInput = ref('soundtrack')

// Remote Control
const remoteEnabled = ref(false)
const remoteLanIp = ref('')
const remoteLanIps = ref<string[]>([])
const remotePort = ref(19876)
const remotePin = ref('')
const remoteTrustedDevices = ref<{ name: string; ip: string; createdAt: number; lastSeen: number }[]>([])

// Lyrics offset display
const lyricsOffsetDisplay = computed(() => {
  const v = player.lyricsOffset
  return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
})

const rpcFormatOptions = [
  {
    value: 'title-artist',
    label: 'Song Title — by Artist',
    preview: 'e.g. "Bohemian Rhapsody" · by Queen',
  },
  {
    value: 'artist-title',
    label: 'Artist — Song Title',
    preview: 'e.g. "Queen" · Bohemian Rhapsody',
  },
  {
    value: 'title-album',
    label: 'Song Title — on Album',
    preview: 'e.g. "Bohemian Rhapsody" · on A Night at the Opera',
  },
  {
    value: 'full',
    label: 'Full — Title by Artist + Album',
    preview: 'e.g. "Bohemian Rhapsody by Queen" · A Night at the Opera',
  },
  {
    value: 'minimal',
    label: 'Minimal — Song Title only',
    preview: 'e.g. "Bohemian Rhapsody"',
  },
]

onMounted(async () => {
  loadSyncConfig()

  const settings = await window.api.getSettings()
  discordEnabled.value = settings.discordRPC !== false
  discordFormat.value = settings.discordRPCFormat || 'title-artist'
  discordClientId.value = settings.discordClientId || ''


  // Load audio / playback settings
  selectedDevice.value = settings.outputDeviceId || ''
  exclusiveMode.value = settings.exclusiveMode === true

  // Query process-level exclusive mode status
  try {
    const status = await window.api.getExclusiveStatus()
    exclusiveModeActiveAtStartup.value = status.active
    exclusivePlatform.value = status.platform
    exclusiveAlsaDevice.value = settings.exclusiveAlsaDevice || ''
  } catch {
    exclusiveModeActiveAtStartup.value = false
  }

  // Enumerate ALSA devices if on Linux
  if (exclusivePlatform.value === 'linux') {
    loadAlsaDevices()
  }

  scrobblingEnabled.value = settings.scrobblingEnabled === true
  lastfmApiKey.value = settings.lastfmApiKey || ''
  lastfmApiSecret.value = settings.lastfmApiSecret || ''
  lastfmSessionKey.value = settings.lastfmSessionKey || ''
  listenbrainzToken.value = settings.listenbrainzToken || ''

  // Load Subsonic settings
  subsonicUrl.value = settings.subsonicUrl || ''
  subsonicUsername.value = settings.subsonicUsername || ''
  subsonicPassword.value = settings.subsonicPassword || ''
  subsonicLegacyAuth.value = settings.subsonicLegacyAuth === true
  subsonicConnected.value = settings.subsonicConnected === true

  // Load export settings
  autoExport.value = settings.autoExport !== false // default true
  exportPath.value = settings.exportPath || ''
  exportDefaultPath.value = await window.api.exportGetDefaultPath()
  autoTagAlbumsFromApi.value = settings.autoTagAlbumsFromApi === true
  soundtrackTagsInput.value = (library.soundtrackTags?.length ? library.soundtrackTags.join(', ') : 'soundtrack')

  // Enumerate audio devices
  player.enumerateOutputDevices()

  // Load log file path
  try { logFilePath.value = await window.api.getLogPath() } catch {}

  // Load remote control config
  try {
    const rc = await window.api.getRemoteConfig()
    remoteEnabled.value = rc.enabled
    remoteLanIp.value = rc.lanIp
    remoteLanIps.value = rc.lanIps || [rc.lanIp]
    remotePort.value = rc.port
    remotePin.value = rc.pin
    remoteTrustedDevices.value = rc.trustedDevices
  } catch (_) { /* remote not available */ }

  // Listen for new trusted devices
  window.api.onRemoteDeviceAdded((device: any) => {
    remoteTrustedDevices.value = [...remoteTrustedDevices.value.filter(d => d.name !== device.name || d.ip !== device.ip), device]
  })

  // Listen for auto-refreshed PIN
  window.api.onRemotePinChanged((pin: string) => {
    remotePin.value = pin
  })

  // Restore custom CSS value for editing
  themeCustomCSS.value = themeStore.customCSS

  document.addEventListener('click', onDeviceClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', onDeviceClickOutside)
})

/* ---------- Remote Control ---------- */
async function toggleRemote() {
  remoteEnabled.value = !remoteEnabled.value
  await window.api.setRemoteEnabled(remoteEnabled.value)
  if (remoteEnabled.value) {
    await window.api.remoteStartServer()
    const rc = await window.api.getRemoteConfig()
    remoteLanIp.value = rc.lanIp
    remoteLanIps.value = rc.lanIps || [rc.lanIp]
    remotePort.value = rc.port
    remotePin.value = rc.pin
    remoteTrustedDevices.value = rc.trustedDevices
    toast.success('Remote control server started')
  } else {
    await window.api.remoteStopServer()
    toast.success('Remote control server stopped')
  }
}

async function regeneratePin() {
  const rc = await window.api.remoteRegeneratePin()
  remotePin.value = rc.pin
  toast.success('PIN regenerated — new devices need the new PIN')
}

async function removeDevice(index: number) {
  const device = remoteTrustedDevices.value[index]
  if (!device) return
  await window.api.remoteRemoveDevice(index)
  remoteTrustedDevices.value.splice(index, 1)
  toast.success(`Revoked ${device.name}`)
}

async function removeAllDevices() {
  if (remoteTrustedDevices.value.length === 0) return
  await window.api.remoteRemoveAllDevices()
  remoteTrustedDevices.value = []
  toast.success('All devices revoked')
}

function formatDeviceTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}

async function toggleDiscord() {
  discordEnabled.value = !discordEnabled.value
  await window.api.mergeSettings({ discordRPC: discordEnabled.value })
  await window.api.toggleDiscordRPC(discordEnabled.value, discordClientId.value || undefined)
  player.setDiscordEnabled(discordEnabled.value)
  toast.success(`Discord RPC ${discordEnabled.value ? 'enabled' : 'disabled'}`)
}

async function onFormatChange() {
  await window.api.mergeSettings({ discordRPCFormat: discordFormat.value })
  player.setDiscordFormat(discordFormat.value)
  toast.success('Discord format updated')
}

async function saveClientId() {
  await window.api.mergeSettings({ discordClientId: discordClientId.value || '' })
  // Reconnect with new client ID
  if (discordEnabled.value) {
    await window.api.toggleDiscordRPC(false)
    await window.api.toggleDiscordRPC(true, discordClientId.value || undefined)
  }
  toast.success('Discord Client ID saved')
}

async function removeFolder(folder: string) {
  await library.removeFolder(folder)
  toast.success('Folder removed')
}

// ── Audio Output ──────────────────────────
async function onDeviceChange() {
  await player.setOutputDevice(selectedDevice.value)
  toast.success('Audio output device changed')
}


async function toggleExclusive() {
  exclusiveMode.value = !exclusiveMode.value
  const partial: Record<string, any> = { exclusiveMode: exclusiveMode.value }
  // Clear ALSA device when disabling
  if (!exclusiveMode.value) {
    partial.exclusiveAlsaDevice = ''
    exclusiveAlsaDevice.value = ''
  }
  await window.api.mergeSettings(partial)
  if (exclusiveNeedsRestart.value) {
    showRestart(
      'Restart Required',
      exclusiveMode.value
        ? 'Exclusive mode has been enabled. The app needs to restart to apply low-level audio changes.'
        : 'Exclusive mode has been disabled. The app needs to restart to revert audio changes.'
    )
  } else {
    toast.success(`Exclusive mode ${exclusiveMode.value ? 'enabled' : 'disabled'}`)
  }
}

async function loadAlsaDevices() {
  alsaLoading.value = true
  try {
    alsaDevices.value = await window.api.listAlsaDevices()
  } catch {
    alsaDevices.value = []
  } finally {
    alsaLoading.value = false
  }
}

async function onAlsaDeviceChange() {
  await window.api.mergeSettings({ exclusiveAlsaDevice: exclusiveAlsaDevice.value })
  // Always needs restart to change ALSA device
  if (exclusiveModeActiveAtStartup.value) {
    showRestart(
      'Restart Required',
      exclusiveAlsaDevice.value
        ? `ALSA device changed to ${exclusiveAlsaDevice.value}. Restart to apply.`
        : 'ALSA device cleared. The app will use PipeWire/PulseAudio after restart.'
    )
  }
}

// ── Playback ──────────────────────────────
async function toggleWaveform() {
  player.setWaveformEnabled(!player.waveformEnabled)
  toast.success(`Waveform ${player.waveformEnabled ? 'enabled' : 'disabled'}`)
}

function toggleNormalization() {
  player.setNormalization(!player.normalization)
  toast.success(`Normalization ${player.normalization ? 'enabled' : 'disabled'} \u2014 restart app to apply`)
}

function onLyricsOffsetInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  player.setLyricsOffset(val)
}

function adjustLyricsOffset(delta: number) {
  player.setLyricsOffset(Math.max(-5, Math.min(5, player.lyricsOffset + delta)))
}

function resetLyricsOffset() {
  player.setLyricsOffset(0)
}

// ── Appearance ────────────────────────────
async function toggleAdaptiveAccent() {
  player.setAdaptiveAccent(!player.adaptiveAccent)
  toast.success(`Adaptive accent ${player.adaptiveAccent ? 'enabled' : 'disabled'}`)
}

function toggleIOSSliders() {
  player.setIOSSliders(!player.iosSliders)
  toast.success(`iOS-style sliders ${player.iosSliders ? 'enabled' : 'disabled'}`)
}

function toggleTransparency() {
  player.setTransparencyEnabled(!player.transparencyEnabled)
  toast.success(`Window transparency ${player.transparencyEnabled ? 'enabled' : 'disabled'}`)
}

// ── Animated Covers ───────────────────────
function toggleAnimatedCovers() {
  player.setAnimatedCoversEnabled(!player.animatedCoversEnabled)
  toast.success(`Animated covers ${player.animatedCoversEnabled ? 'enabled' : 'disabled'}`)
}

function togglePauseAnimatedOnBlur() {
  player.setPauseAnimatedOnBlur(!player.pauseAnimatedOnBlur)
  toast.success(`Pause on focus loss ${player.pauseAnimatedOnBlur ? 'enabled' : 'disabled'}`)
}

async function clearAnimatedCoverCache() {
  cacheClearing.value.animated = true
  try {
    await window.api.clearAnimatedCoverCache()
    toast.success('Animated cover cache cleared')
  } catch {
    toast.error('Failed to clear animated cover cache')
  } finally {
    cacheClearing.value.animated = false
  }
}

// ── Behavior ──────────────────────────────
function toggleTray() {
  player.setTrayEnabled(!player.trayEnabled)
  toast.success(`System tray icon ${player.trayEnabled ? 'enabled' : 'disabled'}`)
}

function toggleAutoFullscreen() {
  player.setAutoFullscreen(!player.autoFullscreen)
  toast.success(`Auto-fullscreen ${player.autoFullscreen ? 'enabled' : 'disabled'}`)
}

function onAutoFullscreenDelayChange(e: Event) {
  const val = Math.max(5, Math.min(300, parseInt((e.target as HTMLInputElement).value) || 30))
  player.setAutoFullscreenDelay(val)
}

function adjustAutoFullscreenDelay(delta: number) {
  const newVal = Math.max(5, Math.min(300, player.autoFullscreenDelay + delta))
  player.setAutoFullscreenDelay(newVal)
}

// ── Scrobbling ────────────────────────────
async function toggleScrobbling() {
  scrobblingEnabled.value = !scrobblingEnabled.value
  player.setScrobblingEnabled(scrobblingEnabled.value)
  toast.success(`Scrobbling ${scrobblingEnabled.value ? 'enabled' : 'disabled'}`)
}

async function saveLastfm() {
  await window.api.mergeSettings({
    lastfmApiKey: lastfmApiKey.value,
    lastfmApiSecret: lastfmApiSecret.value,
    lastfmSessionKey: lastfmSessionKey.value,
  })
  toast.success('Last.fm settings saved')
}

async function saveListenbrainz() {
  await window.api.mergeSettings({ listenbrainzToken: listenbrainzToken.value })
  toast.success('ListenBrainz token saved')
}

// ── Subsonic / Navidrome ──────────────────
async function testSubsonic() {
  subsonicTesting.value = true
  try {
    const ok = await window.api.subsonicTest({
      url: subsonicUrl.value.replace(/\/+$/, ''),
      username: subsonicUsername.value,
      password: subsonicPassword.value,
      useLegacyAuth: subsonicLegacyAuth.value,
    })
    if (ok) {
      subsonicConnected.value = true
      await window.api.mergeSettings({
        subsonicUrl: subsonicUrl.value.replace(/\/+$/, ''),
        subsonicUsername: subsonicUsername.value,
        subsonicPassword: subsonicPassword.value,
        subsonicLegacyAuth: subsonicLegacyAuth.value,
        subsonicConnected: true,
      })
      toast.success('Connected to server')
    } else {
      subsonicConnected.value = false
      toast.error('Connection failed — check credentials')
    }
  } catch (e: any) {
    subsonicConnected.value = false
    toast.error(`Connection error: ${e.message || e}`)
  } finally {
    subsonicTesting.value = false
  }
}

async function syncSubsonicLibrary() {
  subsonicSyncing.value = true
  try {
    const tracks = await window.api.subsonicFetchLibrary()
    library.mergeSubsonicTracks(tracks)
    toast.success(`Synced ${tracks.length} tracks from server`)
  } catch (e: any) {
    toast.error(`Sync failed: ${e.message || e}`)
  } finally {
    subsonicSyncing.value = false
  }
}

async function disconnectSubsonic() {
  await window.api.mergeSettings({
    subsonicUrl: '',
    subsonicUsername: '',
    subsonicPassword: '',
    subsonicLegacyAuth: false,
    subsonicConnected: false,
  })

  subsonicUrl.value = ''
  subsonicUsername.value = ''
  subsonicPassword.value = ''
  subsonicLegacyAuth.value = false
  subsonicConnected.value = false

  library.clearSubsonicTracks()
  toast.success('Disconnected from server')
}

// ── Export / Import ───────────────────────
async function toggleAutoExport() {
  autoExport.value = !autoExport.value
  await window.api.mergeSettings({ autoExport: autoExport.value })
  toast.success(`Auto-export ${autoExport.value ? 'enabled' : 'disabled'}`)
}

async function toggleAutoTagAlbums() {
  autoTagAlbumsFromApi.value = !autoTagAlbumsFromApi.value
  await window.api.mergeSettings({ autoTagAlbumsFromApi: autoTagAlbumsFromApi.value })
  if (autoTagAlbumsFromApi.value) {
    const tagsStore = (await import('@/stores/tags')).useTagsStore()
    const result = await tagsStore.autoTagAlbumsFromFetchedData()
    toast.success(`Auto-tagged ${result.tagged} album${result.tagged !== 1 ? 's' : ''}`)
  } else {
    toast.success('Auto-tagging disabled')
  }
}

function saveSoundtrackTags() {
  const tags = soundtrackTagsInput.value
    .split(',')
    .map(v => v.toLowerCase().trim())
    .filter(Boolean)
  library.setSoundtrackTags(tags.length > 0 ? tags : ['soundtrack'])
  soundtrackTagsInput.value = (library.soundtrackTags.length > 0 ? library.soundtrackTags : ['soundtrack']).join(', ')
  toast.success('Soundtrack tags updated')
}

async function chooseExportPath() {
  const dir = await window.api.exportChooseDir()
  if (!dir) return
  exportPath.value = dir
  await window.api.mergeSettings({ exportPath: dir })
  toast.success('Export location updated')
}

async function resetExportPath() {
  exportPath.value = ''
  await window.api.mergeSettings({ exportPath: null })
  toast.success('Export location reset to default')
}

async function openExportFolder() {
  const dir = exportPath.value || exportDefaultPath.value
  if (dir) {
    await window.api.openPath(dir)
  }
}

async function runExport() {
  exporting.value = true
  try {
    const filePath = await window.api.exportRun(exportPath.value || undefined)
    toast.success(`Backup saved to ${filePath.split('/').pop()}`)
  } catch (e: any) {
    toast.error(`Export failed: ${e.message || e}`)
  } finally {
    exporting.value = false
  }
}

const showRestartDialog = ref(false)
const restartDialogTitle = ref('Restart to Apply')
const restartDialogMessage = ref('Settings were imported successfully. Restart the app to fully apply all changes?')

async function runImport() {
  importing.value = true
  try {
    const result = await window.api.exportImport()
    if (!result) { importing.value = false; return }
    const parts: string[] = []
    if (result.settings) parts.push('settings')
    if (result.favorites > 0) parts.push(`${result.favorites} favorites`)
    if (result.playlists > 0) parts.push(`${result.playlists} playlists`)
    toast.success(`Imported: ${parts.join(', ')}`)
    // Reload everything
    await library.loadLibrary()
    await playlistStore.loadPlaylists()
    await favoritesStore.load()
    const settings = await window.api.getSettings()
    autoExport.value = settings.autoExport !== false
    exportPath.value = settings.exportPath || ''
    // If settings were imported, offer a restart to fully apply
    if (result.settings) {
      showRestart('Restart to Apply', 'Settings were imported successfully. Restart the app to fully apply all changes?')
    }
  } catch (e: any) {
    toast.error(`Import failed: ${e.message || e}`)
  } finally {
    importing.value = false
  }
}

function restartApp() {
  window.api.relaunchApp()
}

function dismissRestart() {
  showRestartDialog.value = false
}

function showRestart(title: string, message: string) {
  restartDialogTitle.value = title
  restartDialogMessage.value = message
  showRestartDialog.value = true
}

// ── Cache Management ──────────────────────
const cacheClearing = ref<Record<string, boolean>>({
  library: false,
  covers: false,
  artist: false,
  waveform: false,
  animated: false,
})

const cacheLabels: Record<string, string> = {
  library: 'Library index',
  covers: 'Cover art',
  artist: 'Artist info',
  waveform: 'Waveform',
}

async function clearCache(target: string) {
  cacheClearing.value[target] = true
  try {
    await window.api.resetCache([target])
    if (target === 'library') {
      await library.loadLibrary()
    }
    toast.success(`${cacheLabels[target] || target} cache cleared`)
  } catch {
    toast.error(`Failed to clear ${cacheLabels[target] || target} cache`)
  } finally {
    cacheClearing.value[target] = false
  }
}

async function clearAllCaches() {
  const targets = ['library', 'covers', 'artist', 'waveform']
  for (const t of targets) cacheClearing.value[t] = true
  cacheClearing.value.animated = true
  try {
    await Promise.all([
      window.api.resetCache(targets),
      window.api.clearAnimatedCoverCache(),
    ])
    await library.loadLibrary()
    toast.success('All caches cleared')
  } catch {
    toast.error('Failed to clear caches')
  } finally {
    for (const t of targets) cacheClearing.value[t] = false
    cacheClearing.value.animated = false
  }
}

async function openLogFile() {
  if (logFilePath.value) {
    window.api.showInExplorer(logFilePath.value)
  }
}
</script>

<style scoped>
.dropdown-enter-active { transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1); }
.dropdown-leave-active { transition: all 0.1s ease-in; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-4px); }
.dropdown-enter-to, .dropdown-leave-from { opacity: 1; transform: translateY(0); }
</style>

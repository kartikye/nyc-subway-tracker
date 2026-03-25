// Main application logic using Leaflet + OpenStreetMap
class SubwayTracker {
    constructor() {
        this.visitedStations = [];
        this.markers = {};
        this.map = null;
        this.currentLineFilter = 'all';
        this.user = null;
        this.isLoginMode = true;
        this.friends = [];
        this.viewingFriend = null;
        this.friendVisited = [];
        this.togetherMode = false;
        this.friendMarkers = [];
        this.init();
    }

    async init() {
        const isAuthenticated = await this.checkAuth();
        
        if (!isAuthenticated) {
            this.showAuthModal();
            return;
        }
        
        this.showApp();
        await this.loadVisitedStations();
        this.initMap();
        this.renderLineFilter();
        this.renderStationList();
        this.updateStats();
        this.attachEventListeners();
        this.loadFriends();
    }

    async checkAuth() {
        try {
            const response = await fetch('auth/me');
            if (response.ok) {
                const data = await response.json();
                this.user = data.user;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Auth check failed:', error);
            return false;
        }
    }

    showAuthModal() {
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
        
        // Tab switching
        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');
        const submitBtn = document.getElementById('auth-submit');
        const emailField = document.getElementById('email-field');
        
        tabLogin.addEventListener('click', () => {
            this.isLoginMode = true;
            tabLogin.classList.add('bg-white', 'shadow');
            tabLogin.classList.remove('text-gray-600');
            tabRegister.classList.remove('bg-white', 'shadow');
            tabRegister.classList.add('text-gray-600');
            submitBtn.textContent = 'Login';
            emailField.classList.add('hidden');
            document.getElementById('auth-email').removeAttribute('required');
        });
        
        tabRegister.addEventListener('click', () => {
            this.isLoginMode = false;
            tabRegister.classList.add('bg-white', 'shadow');
            tabRegister.classList.remove('text-gray-600');
            tabLogin.classList.remove('bg-white', 'shadow');
            tabLogin.classList.add('text-gray-600');
            submitBtn.textContent = 'Create Account';
            emailField.classList.remove('hidden');
            document.getElementById('auth-email').setAttribute('required', 'required');
        });
        
        // Form submission
        document.getElementById('auth-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAuth();
        });
    }

    async handleAuth() {
        const username = document.getElementById('auth-username').value.trim();
        const pin = document.getElementById('auth-pin').value;
        const email = document.getElementById('auth-email')?.value?.trim();
        const errorEl = document.getElementById('auth-error');
        
        errorEl.classList.add('hidden');
        
        const endpoint = this.isLoginMode ? 'auth/login' : 'auth/register';
        const body = this.isLoginMode ? { username, pin } : { username, pin, email };
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.user = data.user;
                document.getElementById('auth-modal').classList.add('hidden');
                this.showApp();
                await this.loadVisitedStations();
                this.initMap();
                this.renderLineFilter();
                this.renderStationList();
                this.updateStats();
                this.attachEventListeners();
                this.loadFriends();
            } else {
                errorEl.textContent = data.error || 'Authentication failed';
                errorEl.classList.remove('hidden');
            }
        } catch (error) {
            errorEl.textContent = 'Network error. Please try again.';
            errorEl.classList.remove('hidden');
        }
    }

    showApp() {
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('username-display').textContent = this.user.username;
        
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
    }

    async handleLogout() {
        try {
            await fetch('auth/logout', { method: 'POST' });
            window.location.reload();
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }

    async loadVisitedStations() {
        try {
            const response = await fetch('api/visited');
            if (response.ok) {
                this.visitedStations = await response.json();
            } else {
                this.visitedStations = [];
            }
        } catch (error) {
            console.error('Error loading visited stations:', error);
            this.visitedStations = [];
        }
    }

    isVisited(stationId) {
        return this.visitedStations.includes(stationId);
    }

    async toggleStation(stationId) {
        // Get all stations in this complex
        const station = STATIONS_BY_ID[stationId];
        const complexStations = STATIONS
            .filter(s => s.complexId === station.complexId)
            .map(s => s.id);
        
        const isCurrentlyVisited = this.visitedStations.includes(stationId);
        
        try {
            if (isCurrentlyVisited) {
                // Unmark all stations in the complex
                for (const id of complexStations) {
                    const index = this.visitedStations.indexOf(id);
                    if (index > -1) {
                        const response = await fetch(`api/visited/${id}`, { method: 'DELETE' });
                        if (response.ok) this.visitedStations.splice(this.visitedStations.indexOf(id), 1);
                    }
                }
            } else {
                // Mark all stations in the complex
                for (const id of complexStations) {
                    if (!this.visitedStations.includes(id)) {
                        const response = await fetch(`api/visited/${id}`, { method: 'POST' });
                        if (response.ok) this.visitedStations.push(id);
                    }
                }
            }
            
            // Update UI for all affected stations
            complexStations.forEach(id => this.updateMarker(id));
            this.updateStationList();
            this.updateStats();
        } catch (error) {
            console.error('Error toggling station:', error);
        }
    }

    async clearAll() {
        if (confirm('Are you sure you want to clear all visited stations?')) {
            try {
                const response = await fetch('api/visited', { method: 'DELETE' });
                if (response.ok) {
                    this.visitedStations = [];
                    this.updateAllMarkers();
                    this.updateStationList();
                    this.updateStats();
                }
            } catch (error) {
                console.error('Error clearing visited stations:', error);
            }
        }
    }

    initMap() {
        this.map = L.map('map').setView([40.7128, -73.97], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        STATIONS.forEach(station => {
            this.createStationMarker(station);
        });
    }

    createStationMarker(station) {
        const lines = station.lines.split(' ');
        const primaryColor = LINE_COLORS[lines[0]] || '#666';
        const isVisited = this.isVisited(station.id);

        const marker = L.circleMarker([station.lat, station.lon], {
            radius: 8,
            fillColor: isVisited ? primaryColor : 'white',
            color: primaryColor,
            weight: 3,
            opacity: 1,
            fillOpacity: isVisited ? 1 : 0.9
        }).addTo(this.map);

        marker.bindPopup(`
            <strong>${station.name}</strong><br>
            <span style="color: ${primaryColor}">●</span> ${station.lines}<br>
            <em>${isVisited ? '✓ Visited' : 'Not visited'}</em>
        `);

        marker.on('click', () => {
            // Don't allow toggling when viewing a friend's map
            if (!this.viewingFriend) {
                this.toggleStation(station.id);
            }
        });

        this.markers[station.id] = { marker, color: primaryColor, station };
    }

    updateMarker(stationId) {
        const markerData = this.markers[stationId];
        if (!markerData) return;

        const { marker, color, station } = markerData;
        const isVisited = this.isVisited(stationId);
        const isFriendVisited = this.friendVisited.includes(stationId);
        
        let fillColor = isVisited ? color : 'white';
        let borderColor = color;
        let fillOpacity = isVisited ? 1 : 0.9;
        
        // If viewing a friend
        if (this.viewingFriend) {
            if (this.togetherMode) {
                // Together mode: highlight unvisited by both
                if (!isVisited && !isFriendVisited) {
                    fillColor = '#eab308'; // Yellow for "visit together"
                    borderColor = '#eab308';
                    fillOpacity = 1;
                } else {
                    fillColor = '#9ca3af'; // Gray out visited stations
                    borderColor = '#9ca3af';
                    fillOpacity = 0.5;
                }
            } else {
                // Friend view mode
                if (isFriendVisited && !isVisited) {
                    fillColor = '#a855f7'; // Purple for friend-only
                    borderColor = '#a855f7';
                    fillOpacity = 1;
                } else if (isVisited && isFriendVisited) {
                    fillColor = color; // Line color for both visited
                    fillOpacity = 1;
                } else if (isVisited) {
                    fillColor = color; // Line color for you
                    fillOpacity = 1;
                }
                // Unvisited by both stays white with line color border
            }
        }
        
        marker.setStyle({ 
            fillColor: fillColor,
            color: borderColor,
            fillOpacity: fillOpacity
        });
        
        let popupContent = `
            <strong>${station.name}</strong><br>
            <span style="color: ${color}">●</span> ${station.lines}<br>
        `;
        
        if (this.viewingFriend) {
            popupContent += `
                <div style="margin-top: 4px; font-size: 12px;">
                    <span style="color: ${isVisited ? '#22c55e' : '#999'}">You: ${isVisited ? '✓' : '✗'}</span>
                    <span style="margin: 0 4px;">|</span>
                    <span style="color: ${isFriendVisited ? '#a855f7' : '#999'}">${this.viewingFriend.username}: ${isFriendVisited ? '✓' : '✗'}</span>
                </div>
            `;
        } else {
            popupContent += `<em>${isVisited ? '✓ Visited' : 'Not visited'}</em>`;
        }
        
        marker.setPopupContent(popupContent);
    }

    updateAllMarkers() {
        Object.keys(this.markers).forEach(id => {
            this.updateMarker(id);
        });
    }

    renderLineFilter() {
        const filterContainer = document.getElementById('line-filter');
        
        const allLines = new Set();
        STATIONS.forEach(s => {
            s.lines.split(' ').forEach(line => allLines.add(line));
        });
        
        const sortedLines = Array.from(allLines).sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            if (!isNaN(aNum)) return -1;
            if (!isNaN(bNum)) return 1;
            return a.localeCompare(b);
        });

        const allBtn = document.createElement('button');
        allBtn.className = 'line-btn px-3 py-1 rounded-full text-sm font-bold mr-1 mb-1 border-2 bg-gray-800 text-white border-gray-800';
        allBtn.textContent = 'All';
        allBtn.dataset.line = 'all';
        filterContainer.appendChild(allBtn);

        sortedLines.forEach(line => {
            const btn = document.createElement('button');
            const color = LINE_COLORS[line] || '#666';
            btn.className = 'line-btn px-3 py-1 rounded-full text-sm font-bold mr-1 mb-1 border-2';
            btn.style.borderColor = color;
            btn.style.backgroundColor = 'white';
            btn.style.color = color;
            btn.textContent = line;
            btn.dataset.line = line;
            filterContainer.appendChild(btn);
        });

        filterContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('line-btn')) {
                this.setLineFilter(e.target.dataset.line);
            }
        });
    }

    setLineFilter(line) {
        this.currentLineFilter = line;
        
        document.querySelectorAll('.line-btn').forEach(btn => {
            const btnLine = btn.dataset.line;
            const color = LINE_COLORS[btnLine] || '#666';
            
            if (btnLine === line) {
                if (btnLine === 'all') {
                    btn.style.backgroundColor = '#1f2937';
                    btn.style.color = 'white';
                } else {
                    btn.style.backgroundColor = color;
                    btn.style.color = ['N', 'Q', 'R', 'W'].includes(btnLine) ? '#333' : 'white';
                }
            } else {
                if (btnLine === 'all') {
                    btn.style.backgroundColor = 'white';
                    btn.style.color = '#1f2937';
                } else {
                    btn.style.backgroundColor = 'white';
                    btn.style.color = color;
                }
            }
        });

        this.renderStationList();
        this.updateStats();
    }

    getFilteredStations() {
        if (this.currentLineFilter === 'all') {
            return STATIONS;
        }
        return STATIONS.filter(s => s.lines.split(' ').includes(this.currentLineFilter));
    }

    getStationOrder(station) {
        const line = this.currentLineFilter;
        
        if (['L', 'G', 'M'].includes(line)) {
            return station.lon;
        }
        if (line === 'S') {
            return station.lon;
        }
        return -station.lat;
    }

    renderStationList() {
        const listContainer = document.getElementById('station-list');
        listContainer.innerHTML = '';

        let stations = this.getFilteredStations();
        
        if (this.currentLineFilter === 'all') {
            stations = [...stations].sort((a, b) => a.name.localeCompare(b.name));
        } else {
            stations = [...stations].sort((a, b) => this.getStationOrder(a) - this.getStationOrder(b));
        }

        stations.forEach(station => {
            const item = this.createStationListItem(station);
            listContainer.appendChild(item);
        });
    }

    createStationListItem(station) {
        const div = document.createElement('div');
        div.className = 'flex items-center p-2 hover:bg-gray-50 rounded';
        div.setAttribute('data-station-item', station.id);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox-${station.id}`;
        checkbox.checked = this.isVisited(station.id);
        checkbox.className = 'w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 flex-shrink-0';
        checkbox.addEventListener('change', () => this.toggleStation(station.id));

        const label = document.createElement('label');
        label.htmlFor = `checkbox-${station.id}`;
        label.className = 'ml-3 flex-1 text-sm cursor-pointer';
        
        label.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                this.map.setView([station.lat, station.lon], 15);
                this.markers[station.id].marker.openPopup();
            }
        });
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-medium text-gray-800';
        nameSpan.textContent = station.name;
        
        const lineSpan = document.createElement('span');
        lineSpan.className = 'ml-2 text-xs text-gray-500';
        lineSpan.textContent = `(${station.lines})`;
        
        // Friend indicator
        if (this.viewingFriend && this.friendVisited.includes(station.id)) {
            const friendSpan = document.createElement('span');
            friendSpan.className = 'ml-2 text-xs text-purple-600';
            friendSpan.textContent = '👤';
            friendSpan.title = `${this.viewingFriend.username} visited`;
            label.appendChild(friendSpan);
        }
        
        label.appendChild(nameSpan);
        label.appendChild(lineSpan);

        div.appendChild(checkbox);
        div.appendChild(label);

        return div;
    }

    updateStationList() {
        const stations = this.getFilteredStations();
        stations.forEach(station => {
            const checkbox = document.getElementById(`checkbox-${station.id}`);
            if (checkbox) checkbox.checked = this.isVisited(station.id);
        });
    }

    updateStats() {
        // Always count ALL unique complexes for total (matches leaderboard)
        const totalComplexes = new Set(STATIONS.map(s => s.complexId));
        
        // Count ALL visited unique complexes (not filtered by line)
        const visitedComplexes = new Set(
            STATIONS
                .filter(s => this.isVisited(s.id))
                .map(s => s.complexId)
        );
        
        document.getElementById('visited-count').textContent = visitedComplexes.size;
        document.getElementById('total-count').textContent = totalComplexes.size;
    }

    attachEventListeners() {
        // Make tracker globally accessible for popup buttons
        window.tracker = this;
        
        document.getElementById('clear-all').addEventListener('click', () => this.clearAll());

        const searchBox = document.getElementById('search-box');
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = document.querySelectorAll('[data-station-item]');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });

        // Rules box dismiss functionality
        const dismissBtn = document.getElementById('dismiss-rules');
        const rulesBox = document.getElementById('rules-box');
        
        if (dismissBtn && rulesBox) {
            const rulesDismissed = localStorage.getItem('rulesDismissed');
            if (rulesDismissed !== 'true') {
                rulesBox.classList.add('visible');
            }
            
            dismissBtn.addEventListener('click', () => {
                rulesBox.classList.remove('visible');
                localStorage.setItem('rulesDismissed', 'true');
            });
        }
        
        // Friends button
        document.getElementById('friends-btn').addEventListener('click', () => this.showFriendsModal());
        document.getElementById('close-friends').addEventListener('click', () => this.hideFriendsModal());
        document.getElementById('friends-modal').addEventListener('click', (e) => {
            if (e.target.id === 'friends-modal') this.hideFriendsModal();
        });
        
        // Friends tabs
        document.getElementById('friends-tab-list').addEventListener('click', () => this.showFriendsTab('list'));
        document.getElementById('friends-tab-requests').addEventListener('click', () => this.showFriendsTab('requests'));
        document.getElementById('friends-tab-add').addEventListener('click', () => this.showFriendsTab('add'));
        
        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettingsModal());
        document.getElementById('close-settings').addEventListener('click', () => this.hideSettingsModal());
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') this.hideSettingsModal();
        });
        document.getElementById('settings-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSettings();
        });
        
        // Friend view controls
        document.getElementById('clear-friend-view').addEventListener('click', () => this.clearFriendView());
        document.getElementById('toggle-together-mode').addEventListener('click', () => this.toggleTogetherMode());
    }
    
    // ============ FRIENDS ============
    
    async loadFriends() {
        try {
            const response = await fetch('api/friends');
            if (response.ok) {
                this.friends = await response.json();
            }
        } catch (error) {
            console.error('Error loading friends:', error);
        }
    }
    
    showFriendsModal() {
        document.getElementById('friends-modal').classList.remove('hidden');
        this.showFriendsTab('list');
        this.loadFriendRequests();
    }
    
    hideFriendsModal() {
        document.getElementById('friends-modal').classList.add('hidden');
    }
    
    showFriendsTab(tab) {
        // Update tab styling
        ['list', 'requests', 'add'].forEach(t => {
            const tabEl = document.getElementById(`friends-tab-${t}`);
            if (t === tab) {
                tabEl.classList.add('tab-active');
                tabEl.classList.remove('text-gray-500');
            } else {
                tabEl.classList.remove('tab-active');
                tabEl.classList.add('text-gray-500');
            }
        });
        
        const content = document.getElementById('friends-content');
        
        if (tab === 'list') {
            this.renderFriendsList(content);
        } else if (tab === 'requests') {
            this.renderFriendRequests(content);
        } else if (tab === 'add') {
            this.renderAddFriend(content);
        }
    }
    
    async renderFriendsList(container) {
        await this.loadFriends();
        
        if (this.friends.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <p class="text-4xl mb-2">👥</p>
                    <p>No friends yet!</p>
                    <p class="text-sm mt-1">Add friends to see their progress</p>
                </div>
            `;
            return;
        }
        
        let html = '<div class="space-y-2">';
        for (const friend of this.friends) {
            html += `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                        <span class="font-medium">${friend.username}</span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.tracker.viewFriend(${friend.id}, '${friend.username}')" 
                                class="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
                            View Map
                        </button>
                        <button onclick="window.tracker.removeFriend(${friend.friendship_id})" 
                                class="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">
                            ✕
                        </button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;
    }
    
    async loadFriendRequests() {
        try {
            const response = await fetch('api/friends/requests');
            if (response.ok) {
                const data = await response.json();
                const badge = document.getElementById('request-badge');
                if (data.incoming.length > 0) {
                    badge.textContent = data.incoming.length;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
                return data;
            }
        } catch (error) {
            console.error('Error loading friend requests:', error);
        }
        return { incoming: [], outgoing: [] };
    }
    
    async renderFriendRequests(container) {
        const data = await this.loadFriendRequests();
        
        let html = '';
        
        if (data.incoming.length > 0) {
            html += '<h3 class="font-semibold text-sm text-gray-600 mb-2">Incoming Requests</h3>';
            html += '<div class="space-y-2 mb-4">';
            for (const req of data.incoming) {
                html += `
                    <div class="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                        <span class="font-medium">${req.username}</span>
                        <div class="flex gap-2">
                            <button onclick="window.tracker.acceptRequest(${req.friendship_id})" 
                                    class="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">
                                Accept
                            </button>
                            <button onclick="window.tracker.declineRequest(${req.friendship_id})" 
                                    class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300">
                                Decline
                            </button>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
        }
        
        if (data.outgoing.length > 0) {
            html += '<h3 class="font-semibold text-sm text-gray-600 mb-2">Sent Requests</h3>';
            html += '<div class="space-y-2">';
            for (const req of data.outgoing) {
                html += `
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span class="font-medium">${req.username}</span>
                        <span class="text-xs text-gray-500">Pending...</span>
                    </div>
                `;
            }
            html += '</div>';
        }
        
        if (data.incoming.length === 0 && data.outgoing.length === 0) {
            html = `
                <div class="text-center py-8 text-gray-500">
                    <p>No pending requests</p>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }
    
    renderAddFriend(container) {
        container.innerHTML = `
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Username or Email</label>
                    <input type="text" id="add-friend-input" placeholder="Enter username or email"
                           class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <button onclick="window.tracker.sendFriendRequest()" 
                        class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700">
                    Send Friend Request
                </button>
                <p id="add-friend-message" class="text-sm text-center hidden"></p>
            </div>
        `;
    }
    
    async sendFriendRequest() {
        const input = document.getElementById('add-friend-input');
        const message = document.getElementById('add-friend-message');
        const identifier = input.value.trim();
        
        if (!identifier) return;
        
        try {
            const response = await fetch('api/friends/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                message.textContent = data.status === 'accepted' 
                    ? `You're now friends with ${data.username}!` 
                    : `Request sent to ${data.username}!`;
                message.className = 'text-sm text-center text-green-600';
                message.classList.remove('hidden');
                input.value = '';
                this.loadFriends();
            } else {
                message.textContent = data.error;
                message.className = 'text-sm text-center text-red-600';
                message.classList.remove('hidden');
            }
        } catch (error) {
            message.textContent = 'Network error. Please try again.';
            message.className = 'text-sm text-center text-red-600';
            message.classList.remove('hidden');
        }
    }
    
    async acceptRequest(friendshipId) {
        try {
            const response = await fetch(`api/friends/${friendshipId}/accept`, { method: 'POST' });
            if (response.ok) {
                this.loadFriends();
                this.showFriendsTab('requests');
            }
        } catch (error) {
            console.error('Error accepting request:', error);
        }
    }
    
    async declineRequest(friendshipId) {
        try {
            const response = await fetch(`api/friends/${friendshipId}`, { method: 'DELETE' });
            if (response.ok) {
                this.showFriendsTab('requests');
            }
        } catch (error) {
            console.error('Error declining request:', error);
        }
    }
    
    async removeFriend(friendshipId) {
        if (!confirm('Remove this friend?')) return;
        
        try {
            const response = await fetch(`api/friends/${friendshipId}`, { method: 'DELETE' });
            if (response.ok) {
                this.loadFriends();
                this.showFriendsTab('list');
                if (this.viewingFriend) {
                    this.clearFriendView();
                }
            }
        } catch (error) {
            console.error('Error removing friend:', error);
        }
    }
    
    async viewFriend(friendId, username) {
        try {
            const response = await fetch(`api/friends/${friendId}/visited`);
            if (response.ok) {
                this.friendVisited = await response.json();
                this.viewingFriend = { id: friendId, username };
                this.togetherMode = false;
                
                // Show friend view bar
                document.getElementById('friend-view-bar').classList.remove('hidden');
                document.getElementById('viewing-friend-name').textContent = username;
                document.getElementById('map-legend').classList.remove('hidden');
                
                // Calculate friend stats
                const friendComplexes = new Set(
                    STATIONS
                        .filter(s => this.friendVisited.includes(s.id))
                        .map(s => s.complexId)
                );
                document.getElementById('friend-stats').textContent = `(${friendComplexes.size} stations)`;
                
                // Update toggle button
                document.getElementById('toggle-together-mode').textContent = 'Show Visit Together';
                
                this.updateAllMarkers();
                this.renderStationList();
                this.hideFriendsModal();
            }
        } catch (error) {
            console.error('Error viewing friend:', error);
        }
    }
    
    clearFriendView() {
        this.viewingFriend = null;
        this.friendVisited = [];
        this.togetherMode = false;
        
        document.getElementById('friend-view-bar').classList.add('hidden');
        document.getElementById('map-legend').classList.add('hidden');
        
        this.updateAllMarkers();
        this.renderStationList();
    }
    
    toggleTogetherMode() {
        this.togetherMode = !this.togetherMode;
        
        const btn = document.getElementById('toggle-together-mode');
        btn.textContent = this.togetherMode ? 'Show All Stations' : 'Show Visit Together';
        
        this.updateAllMarkers();
    }
    
    // ============ SETTINGS ============
    
    showSettingsModal() {
        document.getElementById('settings-modal').classList.remove('hidden');
        document.getElementById('settings-email').value = this.user.email || '';
        document.getElementById('settings-message').classList.add('hidden');
    }
    
    hideSettingsModal() {
        document.getElementById('settings-modal').classList.add('hidden');
    }
    
    async saveSettings() {
        const email = document.getElementById('settings-email').value.trim();
        const message = document.getElementById('settings-message');
        
        if (!email) {
            message.textContent = 'Email is required';
            message.className = 'mt-4 text-sm text-center text-red-600';
            message.classList.remove('hidden');
            return;
        }
        
        try {
            const response = await fetch('auth/email', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.user.email = data.email;
                message.textContent = 'Email saved!';
                message.className = 'mt-4 text-sm text-center text-green-600';
                message.classList.remove('hidden');
                setTimeout(() => this.hideSettingsModal(), 1500);
            } else {
                message.textContent = data.error;
                message.className = 'mt-4 text-sm text-center text-red-600';
                message.classList.remove('hidden');
            }
        } catch (error) {
            message.textContent = 'Network error. Please try again.';
            message.className = 'mt-4 text-sm text-center text-red-600';
            message.classList.remove('hidden');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SubwayTracker();
});

// ============ LEADERBOARD ============

async function showLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const content = document.getElementById('leaderboard-content');
    
    content.innerHTML = '<p class="text-center text-gray-500 py-8">Loading...</p>';
    modal.classList.remove('hidden');
    
    try {
        const response = await fetch('api/leaderboard');
        if (!response.ok) throw new Error('Failed to fetch leaderboard');
        
        const leaderboard = await response.json();
        
        if (leaderboard.length === 0) {
            content.innerHTML = '<p class="text-center text-gray-500 py-8">No users yet!</p>';
            return;
        }
        
        const totalStations = new Set(STATIONS.map(s => s.complexId)).size;
        
        // Get current friends list for checking
        const friendUsernames = window.tracker?.friends?.map(f => f.username) || [];
        
        let html = '<div class="space-y-2">';
        leaderboard.forEach((entry, index) => {
            const percentage = ((entry.station_count / totalStations) * 100).toFixed(1);
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const isCurrentUser = window.tracker && entry.username === window.tracker.user?.username;
            const isFriend = friendUsernames.includes(entry.username);
            
            html += `
                <div class="flex items-center justify-between p-3 rounded-lg ${isCurrentUser ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}">
                    <div class="flex items-center gap-3">
                        <span class="text-lg font-bold w-8">${medal}</span>
                        <span class="font-medium ${isCurrentUser ? 'text-blue-700' : 'text-gray-800'}">${entry.username}</span>
                        ${isFriend ? '<span class="text-xs text-green-600">👥</span>' : ''}
                    </div>
                    <div class="flex items-center gap-3">
                        ${!isCurrentUser && !isFriend ? `
                            <button onclick="addFriendFromLeaderboard('${entry.username}')" 
                                    class="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                                    id="add-btn-${entry.username}">
                                + Add
                            </button>
                        ` : ''}
                        <div class="text-right">
                            <span class="font-bold text-lg">${entry.station_count}</span>
                            <span class="text-gray-500 text-sm">/ ${totalStations}</span>
                            <div class="text-xs text-gray-400">${percentage}%</div>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        
        content.innerHTML = html;
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        content.innerHTML = '<p class="text-center text-red-500 py-8">Failed to load leaderboard</p>';
    }
}

function hideLeaderboard() {
    document.getElementById('leaderboard-modal').classList.add('hidden');
}

async function addFriendFromLeaderboard(username) {
    const btn = document.getElementById(`add-btn-${username}`);
    if (btn) {
        btn.textContent = '...';
        btn.disabled = true;
    }
    
    try {
        const response = await fetch('api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: username })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (btn) {
                btn.textContent = data.status === 'accepted' ? '👥' : 'Sent!';
                btn.className = 'text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded cursor-default';
            }
            // Reload friends list
            if (window.tracker) {
                window.tracker.loadFriends();
            }
        } else {
            if (btn) {
                btn.textContent = data.error === 'Request already sent' ? 'Pending' : 'Error';
                btn.className = 'text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded cursor-default';
            }
        }
    } catch (error) {
        console.error('Error adding friend:', error);
        if (btn) {
            btn.textContent = 'Error';
            btn.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    const closeLeaderboard = document.getElementById('close-leaderboard');
    const leaderboardModal = document.getElementById('leaderboard-modal');
    
    if (leaderboardBtn) {
        leaderboardBtn.addEventListener('click', showLeaderboard);
    }
    
    if (closeLeaderboard) {
        closeLeaderboard.addEventListener('click', hideLeaderboard);
    }
    
    if (leaderboardModal) {
        leaderboardModal.addEventListener('click', (e) => {
            if (e.target === leaderboardModal) {
                hideLeaderboard();
            }
        });
    }
});

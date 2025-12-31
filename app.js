// Main application logic using Leaflet + OpenStreetMap
class SubwayTracker {
    constructor() {
        this.visitedStations = [];
        this.markers = {};
        this.map = null;
        this.currentLineFilter = 'all';
        this.user = null;
        this.isLoginMode = true;
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
        
        tabLogin.addEventListener('click', () => {
            this.isLoginMode = true;
            tabLogin.classList.add('bg-white', 'shadow');
            tabLogin.classList.remove('text-gray-600');
            tabRegister.classList.remove('bg-white', 'shadow');
            tabRegister.classList.add('text-gray-600');
            submitBtn.textContent = 'Login';
        });
        
        tabRegister.addEventListener('click', () => {
            this.isLoginMode = false;
            tabRegister.classList.add('bg-white', 'shadow');
            tabRegister.classList.remove('text-gray-600');
            tabLogin.classList.remove('bg-white', 'shadow');
            tabLogin.classList.add('text-gray-600');
            submitBtn.textContent = 'Create Account';
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
        const errorEl = document.getElementById('auth-error');
        
        errorEl.classList.add('hidden');
        
        const endpoint = this.isLoginMode ? 'auth/login' : 'auth/register';
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, pin })
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
        const complexStations = typeof getComplexStations === 'function' 
            ? getComplexStations(stationId) 
            : [stationId];
        
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
            <em>${this.isVisited(station.id) ? '✓ Visited' : 'Not visited'}</em>
        `);

        marker.on('click', () => {
            this.toggleStation(station.id);
            marker.setPopupContent(`
                <strong>${station.name}</strong><br>
                <span style="color: ${primaryColor}">●</span> ${station.lines}<br>
                <em>${this.isVisited(station.id) ? '✓ Visited' : 'Not visited'}</em>
            `);
        });

        this.markers[station.id] = { marker, color: primaryColor, lines: lines };
    }

    updateMarker(stationId) {
        const markerData = this.markers[stationId];
        if (markerData) {
            const isVisited = this.isVisited(stationId);
            markerData.marker.setStyle({
                fillColor: isVisited ? markerData.color : 'white',
                fillOpacity: isVisited ? 1 : 0.9
            });
        }
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
        const filtered = this.getFilteredStations();
        
        // Count unique complexes for total
        const totalComplexes = new Set(filtered.map(s => 
            typeof getComplexId === 'function' ? getComplexId(s.id) : s.id
        ));
        
        // Count visited unique complexes
        const visitedComplexes = new Set(
            filtered
                .filter(s => this.isVisited(s.id))
                .map(s => typeof getComplexId === 'function' ? getComplexId(s.id) : s.id)
        );
        
        document.getElementById('visited-count').textContent = visitedComplexes.size;
        document.getElementById('total-count').textContent = totalComplexes.size;
    }

    attachEventListeners() {
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
        
        // Count unique complexes (same method as updateStats)
        const totalStations = new Set(STATIONS.map(s => 
            typeof getComplexId === 'function' ? getComplexId(s.id) : s.id
        )).size;
        
        let html = '<div class="space-y-2">';
        leaderboard.forEach((entry, index) => {
            const percentage = ((entry.station_count / totalStations) * 100).toFixed(1);
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const isCurrentUser = window.subwayTracker && entry.username === window.subwayTracker.currentUser?.username;
            
            html += `
                <div class="flex items-center justify-between p-3 rounded-lg ${isCurrentUser ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}">
                    <div class="flex items-center gap-3">
                        <span class="text-lg font-bold w-8">${medal}</span>
                        <span class="font-medium ${isCurrentUser ? 'text-blue-700' : 'text-gray-800'}">${entry.username}</span>
                    </div>
                    <div class="text-right">
                        <span class="font-bold text-lg">${entry.station_count}</span>
                        <span class="text-gray-500 text-sm">/ ${totalStations}</span>
                        <div class="text-xs text-gray-400">${percentage}%</div>
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

// Set up leaderboard event listeners when DOM is ready
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
    
    // Close modal when clicking outside
    if (leaderboardModal) {
        leaderboardModal.addEventListener('click', (e) => {
            if (e.target === leaderboardModal) {
                hideLeaderboard();
            }
        });
    }
});

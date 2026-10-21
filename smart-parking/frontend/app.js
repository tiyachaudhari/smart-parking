const API_BASE = '/api';

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Global UI State
let currentUser = null;
let currentVehicles = [];
let allSlots = [];
let activeBookings = [];
let slotLockTimer = null;
let activeModalBookingId = null;

// Routing logic based on page
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    if (path.includes('register.html')) {
        setupRegister();
    } else if (path.includes('login.html')) {
        setupLogin();
    } else if (path.includes('dashboard.html')) {
        checkAuth().then(isAuth => {
            if (!isAuth) window.location.href = '/login.html';
            else initDashboard();
        });
    }
});

async function apiCall(endpoint, method = 'GET', body = null) {
    const config = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) config.body = JSON.stringify(body);
    
    try {
        const res = await fetch(API_BASE + endpoint, config);
        const data = await res.json();
        if (!res.ok && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
        }
        return data;
    } catch (e) {
        console.error('API Error:', e);
        return { success: false, message: 'Network error or server down.' };
    }
}

// ------ AUTH PAGES ------
function setupRegister() {
    const regForm = document.getElementById('registerForm');
    const vehForm = document.getElementById('initialVehicleForm');
    
    if(regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                name: document.getElementById('regName').value,
                email: document.getElementById('regEmail').value,
                phone: document.getElementById('regPhone').value,
                password: document.getElementById('regPassword').value
            };
            const res = await apiCall('/register', 'POST', payload);
            if (res.success) {
                document.getElementById('registerCard').style.display = 'none';
                document.getElementById('addVehicleCard').style.display = 'block';
                // Need to login automatically to add vehicle since /vehicle requires auth
                await apiCall('/login', 'POST', { email: payload.email, password: payload.password });
            } else {
                showToast(res.message, 'error');
            }
        });
    }

    if(vehForm) {
        vehForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                vehicle_number: document.getElementById('vehNumber').value,
                vehicle_type: document.getElementById('vehType').value
            };
            const res = await apiCall('/vehicle', 'POST', payload);
            if (res.success) {
                document.getElementById('addVehicleCard').style.display = 'none';
                document.getElementById('successCard').style.display = 'block';
                
                // Fetch me to get user ID
                const meRes = await apiCall('/me');
                if (meRes.success) {
                    document.getElementById('successUserId').textContent = meRes.data.user.user_id;
                    document.getElementById('successVehId').textContent = res.data.vehicle_id;
                    document.getElementById('successVehNo').textContent = payload.vehicle_number;
                }
                
                let count = 3;
                const int = setInterval(() => {
                    count--;
                    document.getElementById('redirectCountdown').textContent = count;
                    if(count <= 0) {
                        clearInterval(int);
                        window.location.href = '/dashboard.html';
                    }
                }, 1000);
            } else {
                showToast(res.message, 'error');
            }
        });
    }
}

function setupLogin() {
    const form = document.getElementById('loginForm');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                email: document.getElementById('loginEmail').value,
                password: document.getElementById('loginPassword').value
            };
            const res = await apiCall('/login', 'POST', payload);
            if (res.success) {
                window.location.href = '/dashboard.html';
            } else {
                showToast(res.message, 'error');
            }
        });
    }
}

// ------ DASHBOARD ------
async function checkAuth() {
    const res = await apiCall('/me');
    if (res.success) {
        currentUser = res.data.user;
        currentVehicles = res.data.vehicles;
        return true;
    }
    return false;
}

async function initDashboard() {
    // Populate User info
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userId').textContent = currentUser.user_id;
    
    // Vehicles
    renderVehicles();
    
    // Listeners
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await apiCall('/logout', 'POST');
        window.location.href = '/login.html';
    });
    
    document.getElementById('activeVehicleSelect').addEventListener('change', () => renderSlotsGrid(allSlots));
    
    document.getElementById('openAddVehicleModal').addEventListener('click', () => {
        document.getElementById('addVehModal').classList.add('active');
    });

    // Smart Auto-Recommend (Cursor) 
    document.getElementById('btnRecommendSlot').addEventListener('click', async () => {
        const activeSel = document.getElementById('activeVehicleSelect');
        if (!activeSel || !activeSel.options[activeSel.selectedIndex]) {
            return showToast('Please select a vehicle first.', 'error');
        }
        const selType = activeSel.options[activeSel.selectedIndex].dataset.type;
        
        showToast('Scanning grid for the absolute cheapest parking slot...', 'success');
        
        const res = await apiCall(`/recommend-slot?vehicle_type=${selType}`);
        if(res.success && res.data) {
            initBooking(res.data.lot_id, res.data);
        } else {
            showToast(res.message || 'No slots available.', 'error');
        }
    });

    document.getElementById('dashAddVehicleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            vehicle_number: document.getElementById('dashVehNumber').value,
            vehicle_type: document.getElementById('dashVehType').value
        };
        const res = await apiCall('/vehicle', 'POST', payload);
        if (res.success) {
            showToast('Vehicle added successfully!');
            document.getElementById('addVehModal').classList.remove('active');
            e.target.reset();
            const meRes = await apiCall('/me');
            if (meRes.success) {
                currentVehicles = meRes.data.vehicles;
                renderVehicles();
                if (allSlots.length > 0) renderSlotsGrid(allSlots);
            }
        } else showToast(res.message, 'error');
    });

    document.getElementById('confirmPaymentBtn').addEventListener('click', handlePaymentConfirm);
    
    document.getElementById('closeReceiptBtn').addEventListener('click', () => {
        document.getElementById('receiptModal').classList.remove('active');
        fetchInitialData(); // Refresh everything
    });

    // Initial Fetch
    await fetchInitialData();
    
    // Polling every 5s for DB state updates
    setInterval(fetchInitialData, 5000);
}

function renderVehicles() {
    const pillContainer = document.getElementById('vehiclePills');
    const select = document.getElementById('activeVehicleSelect');
    
    pillContainer.innerHTML = '';
    const currentSelectValue = select.value;
    select.innerHTML = '';
    
    if (currentVehicles.length === 0) {
        select.innerHTML = '<option disabled selected>No vehicles found</option>';
        return;
    }

    currentVehicles.forEach(v => {
        pillContainer.innerHTML += `<div class="vehicle-pill" style="display: flex; align-items: center; justify-content: space-between;">
            <div>${v.vehicle_number} (${v.vehicle_type}) <span style="font-size: 0.75rem; background: var(--surface); padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: 0.5rem; opacity: 0.8;">#${v.vehicle_id}</span></div>
            <button onclick="deleteVehicle(${v.vehicle_id})" style="background: transparent; border: none; color: #ff5252; cursor: pointer; font-size: 1.25rem; font-weight: bold; padding: 0 0.5rem;" title="Remove Vehicle">&times;</button>
        </div>`;
        
        const option = document.createElement('option');
        option.value = v.vehicle_id;
        option.dataset.type = v.vehicle_type;
        option.textContent = `${v.vehicle_number} (${v.vehicle_type})`;
        select.appendChild(option);
    });
    
    if (currentSelectValue && currentVehicles.some(v => v.vehicle_id == currentSelectValue)) {
        select.value = currentSelectValue;
    }
}

async function fetchInitialData() {
    // parallel fetch slots & bookings
    const [slotsRes, bookingsRes] = await Promise.all([
        apiCall('/slots'),
        apiCall('/my-bookings')
    ]);
    
    if (slotsRes.success) {
        allSlots = slotsRes.data;
        renderSlotsGrid(allSlots);
    }
    
    if (bookingsRes.success) {
        activeBookings = bookingsRes.data.active;
        renderActiveBookings();
    }
}

function renderActiveBookings() {
    const panel = document.getElementById('activeBookingsPanel');
    if (!activeBookings || activeBookings.length === 0) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'block';
    panel.innerHTML = `<h3>Active Bookings</h3><div style="height: 1rem;"></div>`;
    
    activeBookings.forEach(b => {
        const div = document.createElement('div');
        div.className = 'booking-panel';
        div.innerHTML = `
            <div class="booking-info">
                <h4>Slot F${b.floor_no}-S${b.slot_no} • ${b.vehicle_number}</h4>
                <div class="booking-meta">
                    Booked at: <span>${new Date(b.entry_time || b.lock_expires_at).toLocaleTimeString()}</span> | 
                    Status: <b style="color: ${b.booking_status==='Active' ? 'var(--status-occ)' : 'var(--status-locked)'}">${b.booking_status}</b>
                </div>
            </div>
            <div>
                ${b.booking_status === 'Active' 
                    ? `<button class="btn-primary" onclick="exitVehicle(${b.booking_id})" style="background: var(--status-occ);">Exit & Pay</button>` 
                    : `<span style="font-size:0.875rem; color:var(--status-locked); font-weight:600;">Awaiting Payment...</span>`
                }
            </div>
        `;
        panel.appendChild(div);
    });
}

function renderSlotsGrid(slots) {
    const container = document.getElementById('slotsGridContainer');
    container.innerHTML = '';
    
    const activeSel = document.getElementById('activeVehicleSelect');
    let selType = null;
    if (activeSel.options[activeSel.selectedIndex]) {
        selType = activeSel.options[activeSel.selectedIndex].dataset.type;
    }
    
    // Group slots by floor
    const floors = {};
    slots.forEach(s => {
        if (!floors[s.floor_no]) floors[s.floor_no] = [];
        floors[s.floor_no].push(s);
    });
    
    Object.keys(floors).sort().forEach(fn => {
        const fDiv = document.createElement('div');
        fDiv.className = 'floor-section';
        fDiv.innerHTML = `<h3 class="floor-title">Floor ${fn}</h3><div class="slots-grid" id="fgrid-${fn}"></div>`;
        container.appendChild(fDiv);
        
        const grid = document.getElementById(`fgrid-${fn}`);
        
        floors[fn].forEach(s => {
            const card = document.createElement('div');
            card.className = 'slot-card';
            
            const isMatch = s.slot_status === 'Available' && selType === s.slot_type;
            if (isMatch) {
                card.classList.add('cursor-bookable');
                card.onclick = () => initBooking(s.lot_id, s);
            }
            
            const zoneColorClass = 'zone-' + s.zone.toLowerCase();
            const statusColorClass = s.slot_status === 'Available' ? 'status-avail' : (s.slot_status === 'Locked' ? 'status-locked' : 'status-occ');
            
            card.innerHTML = `
                <div>
                    <div class="slot-header">
                        <span class="slot-id">F${s.floor_no}-S${s.slot_no}</span>
                        <span class="slot-type">${s.slot_type}</span>
                    </div>
                    <div class="slot-badges">
                        <span class="badge ${zoneColorClass}">${s.zone}</span>
                        <span class="badge ${statusColorClass}">${s.slot_status}</span>
                    </div>
                </div>
                <div class="slot-price">~₹${s.min_charge_fallback}/hr</div>
            `;
            grid.appendChild(card);
        });
    });
}

async function initBooking(lot_id, slotInfo) {
    const vehicle_id = document.getElementById('activeVehicleSelect').value;
    if (!vehicle_id) return showToast('Please add or select a vehicle first.', 'error');
    
    const res = await apiCall('/book', 'POST', { lot_id, vehicle_id });
    if (!res.success) return showToast(res.message, 'error');
    
    // Populate Modal
    activeModalBookingId = res.data.booking_id;
    document.getElementById('modalSlotId').textContent = `F${slotInfo.floor_no}-S${slotInfo.slot_no}`;
    document.getElementById('modalZone').textContent = slotInfo.zone;
    document.getElementById('modalType').textContent = slotInfo.slot_type;
    
    let base = 0;
    if (slotInfo.slot_type === '2W') base = 15;
    else if (slotInfo.slot_type === '4W') base = 40;
    else if (slotInfo.slot_type === 'Heavy') base = 80;
    
    let sur = 0;
    if (slotInfo.zone === 'Gate') sur = 20;
    else if (slotInfo.zone === 'Far') sur = -10;
    
    document.getElementById('modalBaseRate').textContent = base;
    document.getElementById('modalSurcharge').textContent = sur;
    
    // Start lock timer logic
    const expiresAt = new Date(res.data.lock_expires_at).getTime();
    startLockTimer(expiresAt);
    
    document.getElementById('bookingModal').classList.add('active');
    fetchInitialData(); // get updated locked slot
}

function startLockTimer(expiresAt) {
    if (slotLockTimer) clearInterval(slotLockTimer);
    
    const timerElem = document.getElementById('modalLockTimer');
    
    slotLockTimer = setInterval(() => {
        const now = new Date().getTime();
        const diff = expiresAt - now;
        
        if (diff <= 0) {
            clearInterval(slotLockTimer);
            document.getElementById('bookingModal').classList.remove('active');
            showToast('Slot lock expired!', 'error');
            fetchInitialData();
            return;
        }
        
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        timerElem.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 1000);
}

async function handlePaymentConfirm() {
    const paymentMethod = document.getElementById('paymentMethod').value;
    const res = await apiCall('/confirm-payment', 'POST', { booking_id: activeModalBookingId, payment_method: paymentMethod });
    
    if (res.success) {
        clearInterval(slotLockTimer);
        document.getElementById('bookingModal').classList.remove('active');
        showToast('Payment Confirmed! Slot is now occupied.');
        fetchInitialData();
    } else {
        showToast(res.message, 'error');
        if (res.message.includes('expired')) document.getElementById('bookingModal').classList.remove('active');
    }
}

async function exitVehicle(booking_id) {
    if(!confirm('Are you sure you want to exit and pay?')) return;
    
    const res = await apiCall('/exit', 'POST', { booking_id });
    if(res.success) {
        const data = res.data;
        document.getElementById('recEntry').textContent = new Date(data.entry_time).toLocaleString();
        document.getElementById('recExit').textContent = new Date(data.exit_time).toLocaleString();
        document.getElementById('recDuration').textContent = data.duration;
        document.getElementById('recAmount').textContent = data.amount;
        
        document.getElementById('receiptModal').classList.add('active');
        showToast('Exit recorded successfully!');
    } else {
        showToast(res.message, 'error');
    }
}

async function deleteVehicle(vehicle_id) {
    if (!confirm('Are you sure you want to remove this vehicle?')) return;
    
    const res = await apiCall(`/vehicle/${vehicle_id}`, 'DELETE');
    if (res.success) {
        showToast('Vehicle removed successfully!');
        const meRes = await apiCall('/me');
        if (meRes.success) {
            currentVehicles = meRes.data.vehicles;
            renderVehicles();
            if (allSlots.length > 0) renderSlotsGrid(allSlots);
        }
    } else {
        showToast(res.message, 'error');
    }
}

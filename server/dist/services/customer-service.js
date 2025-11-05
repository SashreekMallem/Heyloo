import { supabase } from '../lib/supabase.js';
export async function findOrCreateCustomer(restaurantId, phoneNumber, fullName) {
    const phone = phoneNumber.replace(/\D/g, '');
    const { data, error } = await supabase
        .from('customers')
        .select('id,first_name,last_name,email,total_orders,total_spent')
        .eq('restaurant_id', restaurantId)
        .eq('phone_number', phone)
        .limit(1)
        .maybeSingle();
    if (error) {
        throw Object.assign(new Error('Failed to fetch customer'), {
            status: 500,
            details: error
        });
    }
    if (data) {
        return data;
    }
    const [firstName, ...rest] = (fullName ?? '').split(' ').filter(Boolean);
    const lastName = rest.join(' ') || null;
    const { data: inserted, error: insertError } = await supabase
        .from('customers')
        .insert({
        restaurant_id: restaurantId,
        phone_number: phone,
        first_name: firstName ?? null,
        last_name: lastName,
        total_orders: 0,
        total_spent: 0
    })
        .select('id,first_name,last_name,email,total_orders,total_spent')
        .maybeSingle();
    if (insertError || !inserted) {
        throw Object.assign(new Error('Failed to create customer'), {
            status: 500,
            details: insertError
        });
    }
    return inserted;
}
export async function getCustomerAddresses(customerId, restaurantId) {
    const { data, error } = await supabase
        .from('customer_addresses')
        .select('id,label,street,city,state,postal_code,is_default')
        .eq('customer_id', customerId)
        .eq('restaurant_id', restaurantId)
        .order('is_default', { ascending: false });
    if (error) {
        throw Object.assign(new Error('Failed to load customer addresses'), {
            status: 500,
            details: error
        });
    }
    return data ?? [];
}

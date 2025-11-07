import { Link } from 'react-router-dom';
import { ArrowLeft, Headphones } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Link to="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Headphones className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
              <p className="text-slate-600">Heyloo Technologies</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="space-y-8">
          <div className="text-sm text-slate-500 mb-8">
            Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">1. Information We Collect</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We collect information necessary to provide our AI phone assistant services to restaurants:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li><strong>Call Information:</strong> Phone numbers, call recordings, and conversation transcripts for order processing and service improvement</li>
                <li><strong>Order Data:</strong> Customer orders, preferences, and payment information processed through your POS system</li>
                <li><strong>Restaurant Data:</strong> Menu items, pricing, availability, and business hours from your connected POS system</li>
                <li><strong>Account Information:</strong> Business contact details, billing information, and service preferences</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">2. How We Use Your Information</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We use collected information solely for providing and improving our services:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li><strong>Service Delivery:</strong> Process customer orders, integrate with your POS system, and provide customer support</li>
                <li><strong>Service Improvement:</strong> Analyze call patterns and order data to enhance AI performance and accuracy</li>
                <li><strong>Communication:</strong> Send order confirmations, service notifications, and support messages</li>
                <li><strong>Compliance:</strong> Meet legal requirements and protect against fraud or misuse</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">3. Information Sharing</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We do not sell personal information. We may share information only in these limited circumstances:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li><strong>Service Providers:</strong> With trusted vendors who help us provide services (payment processing, cloud hosting, analytics)</li>
                <li><strong>POS Integration:</strong> With your connected POS system to process orders and sync menu data</li>
                <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect our rights and safety</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">4. Data Security</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We implement industry-standard security measures to protect your information:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li><strong>Encryption:</strong> All data is encrypted in transit and at rest using industry-standard protocols</li>
                <li><strong>Access Controls:</strong> Strict access controls limit who can view your data</li>
                <li><strong>Regular Audits:</strong> We regularly review and update our security practices</li>
                <li><strong>Secure Infrastructure:</strong> We use enterprise-grade cloud infrastructure with robust security controls</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">5. Your Rights and Choices</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                You have important rights regarding your personal information:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li><strong>Access:</strong> Request access to the personal information we have about you</li>
                <li><strong>Correction:</strong> Request correction of inaccurate personal information</li>
                <li><strong>Deletion:</strong> Request deletion of your personal information, subject to legal requirements</li>
                <li><strong>Data Portability:</strong> Request a copy of your data in a portable format</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">6. Data Retention</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We retain personal information only as long as necessary for our legitimate business purposes, 
                legal obligations, and to resolve disputes. Call recordings and transcripts are typically 
                retained for 90 days unless longer retention is required for legal or business purposes.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">7. Children's Privacy</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                Our services are designed for businesses and are not intended for children under 13. 
                We do not knowingly collect personal information from children under 13.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">8. Changes to This Policy</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We may update this privacy policy from time to time. We will notify you of any material 
                changes by email or through our service. Your continued use of our services after such 
                changes constitutes acceptance of the updated policy.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">9. Contact Us</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                If you have any questions about this privacy policy or our data practices, please contact us:
              </p>
              <div className="bg-slate-50 p-4 rounded-lg mt-4">
                <p className="text-slate-700 font-medium">Heyloo Technologies</p>
                <p className="text-slate-600">Email: ms@eduflixai.com</p>
                <p className="text-slate-600">Support: ms@eduflixai.com</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
